# csv-reader-speed-01 — fast drop-in for csv-reader 1.0.0

`solve.js` returns exactly csv-reader 1.0.0's `{columns, rows, errors}` for
every `{text, header}` input, but reads with `indexOf`/regex scanning instead
of one character at a time. `main.ts` is the kit's driver, unchanged.

Approach: most records are plain (no quote, no stray CR) — they are sliced
whole and split on commas in one go. Records with a quote or a stray CR go
field by field: unquoted fields are scanned with a sticky delimiter regex
(`test()`, so no match array is allocated), quoted fields jump to their next
quote with `indexOf` and only touch line counting when a chunk actually holds
a line break. Error order, line numbers and row padding follow the reference
exactly; nothing is read from the clock, so runs are byte-identical.

Practice set (kit scorer, 6 cases, ~10 MB): 6/6 cases identical to the
reference, ~86 ms median pure parse vs ~509 ms for the house baseline
(~5.9x). 20,000 randomized tricky inputs also match the reference exactly.
