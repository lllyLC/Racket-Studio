#lang racket/base
;; Racket Studio test runner.
;; Loads the program with the test forms removed (so the language's own test summary does not
;; print), then evaluates every test in the module's namespace and reports it as JSON lines.
(require racket/list racket/function json)

(define file (path->complete-path (vector-ref (current-command-line-arguments) 0)))
(define-values (dir _n _d) (split-path file))

(define (emit h) (write-string "\u001eRS:") (write-json h) (newline) (flush-output))
(define (fail! m) (eprintf "RS-RUNNER-FAIL: ~a\n" m) (exit 99))
(define (msg e) (if (exn? e) (exn-message e) (format "~a" e)))

(define heads '(check-expect check-within check-error check-satisfied check-member-of check-range))
(define (test-form? s)
  (define l (and (syntax? s) (syntax->list s)))
  (and l (pair? l) (memq (syntax-e (car l)) heads) #t))

(define stx
  (with-handlers ([(λ (e) #t) (λ (e) (fail! (msg e)))])
    (parameterize ([read-accept-reader #t] [read-accept-lang #t] [current-load-relative-directory dir])
      (call-with-input-file file (λ (in) (port-count-lines! in) (read-syntax file in))))))
(when (eof-object? stx) (fail! "empty file"))

;; -> (cons module-syntax-without-tests list-of-test-syntax)
(define (strip stx)
  (define parts (syntax->list stx))
  (unless (and parts (= (length parts) 4) (eq? (syntax-e (car parts)) 'module)) (error "unexpected module shape"))
  (define body-stx (cadddr parts))
  (define body (syntax->list body-stx))
  (define forms (cdr body))
  (cons (datum->syntax stx
                       (list (car parts) (cadr parts) (caddr parts)
                             (datum->syntax body-stx (cons (car body) (filter (negate test-form?) forms)) body-stx))
                       stx stx)
        (filter test-form? forms)))

(define stripped
  (with-handlers ([(λ (e) #t) (λ (e) (emit (hasheq 'type "note" 'text "Could not separate tests; the language's own test output follows.")) (cons stx '()))])
    (strip stx)))
(define new-stx (car stripped))
(define tests (cdr stripped))

(define ns (make-base-namespace))
(parameterize ([current-namespace ns] [current-directory dir] [current-load-relative-directory dir])
  (parameterize ([current-module-declare-name (make-resolved-module-path file)])
    (eval new-stx))
  (dynamic-require file #f))
(flush-output)

(define mns
  (with-handlers ([(λ (e) #t) (λ (e) (fail! (msg e)))])
    (parameterize ([current-namespace ns]) (module->namespace file))))

(define (ev s) (parameterize ([current-namespace mns]) (eval (syntax->datum s))))
(define (try thunk) (with-handlers ([exn:fail? (λ (e) (cons 'err (exn-message e)))]) (cons 'ok (thunk))))
(define (show v) (format "~s" v))
(define (src s) (format "~s" (syntax->datum s)))
(define (val r) (if (eq? (car r) 'ok) (show (cdr r)) (string-append "error: " (cdr r))))
(define (ok? r) (eq? (car r) 'ok))
(define (within? a b e)
  (cond [(and (real? a) (real? b)) (<= (abs (- a b)) e)]
        [(and (pair? a) (pair? b)) (and (within? (car a) (car b) e) (within? (cdr a) (cdr b) e))]
        [else (equal? a b)]))

(define (run-test t)
  (define l (syntax->list t))
  (define head (syntax-e (car l)))
  (define args (cdr l))
  (define line (or (syntax-line t) 0))
  (define (rec expr expected actual passed)
    (hasheq 'type "test" 'kind (symbol->string head) 'line line
            'expr expr 'expected expected 'actual actual 'passed (and passed #t)))
  (with-handlers ([exn:fail? (λ (e) (rec (src t) "?" (exn-message e) #f))])
    (case head
      [(check-expect check-within)
       (let* ([a (try (λ () (ev (car args))))]
              [b (try (λ () (ev (cadr args))))]
              [eps (and (eq? head 'check-within) (try (λ () (ev (caddr args)))))])
         (rec (src (car args)) (val b) (val a)
              (and (ok? a) (ok? b) (or (not eps) (ok? eps))
                   (if eps (within? (cdr a) (cdr b) (cdr eps)) (equal? (cdr a) (cdr b))))))]
      [(check-error)
       (let* ([a (try (λ () (ev (car args))))]
              [m (and (pair? (cdr args)) (try (λ () (ev (cadr args)))))])
         (rec (src (car args))
              (if m (string-append "error with message " (val m)) "an error")
              (if (ok? a) (string-append "no error, returned " (show (cdr a))) (string-append "error: " (cdr a)))
              (and (not (ok? a)) (or (not m) (and (ok? m) (equal? (cdr a) (cdr m)))))))]
      [(check-satisfied)
       (let* ([a (try (λ () (ev (car args))))]
              [p (try (λ () (ev (cadr args))))])
         (rec (src (car args)) (string-append "satisfies " (src (cadr args))) (val a)
              (and (ok? a) (ok? p) ((cdr p) (cdr a)))))]
      [(check-member-of)
       (let* ([a (try (λ () (ev (car args))))]
              [vs (map (λ (s) (try (λ () (ev s)))) (cdr args))])
         (rec (src (car args)) (string-append "one of " (string-join* (map val vs))) (val a)
              (and (ok? a) (andmap ok? vs) (member (cdr a) (map cdr vs)))))]
      [(check-range)
       (let* ([a (try (λ () (ev (car args))))]
              [lo (try (λ () (ev (cadr args))))]
              [hi (try (λ () (ev (caddr args))))])
         (rec (src (car args)) (format "between ~a and ~a" (val lo) (val hi)) (val a)
              (and (ok? a) (ok? lo) (ok? hi) (<= (cdr lo) (cdr a) (cdr hi)))))]
      [else (rec (src t) "?" "unsupported test form" #f)])))

(define (string-join* l)
  (if (null? l) "" (foldl (λ (s acc) (string-append acc " " s)) (car l) (cdr l))))

(define results (for/list ([t (in-list tests)]) (let ([r (run-test t)]) (emit r) r)))
(emit (hasheq 'type "summary"
              'passed (length (filter (λ (r) (hash-ref r 'passed)) results))
              'total (length results)))
