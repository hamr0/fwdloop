# w1-tie — run-1
Passed · 18 Nov 2026

## 1. Read the expenses sheet

### The answer
Read the "expenses" sheet as addressable cells. Header: Date, Description, Amount, Tax. Data occupies rows 2–41 (40 expense records).

Structure: columns A=Date, B=Description, C=Amount, D=Tax. Dates run 2026-09-01 through 2026-09-28, then restart at 2026-09-01 at row 30 (rows 2–29 and rows 30–41 are sequential date blocks, so dates are duplicated across the two blocks — not an error, just a repeated range).

Amount formatting notes: row 7 (item 5) has a thousands separator: "1,200.50" (numeric 1200.50). All other Amount/Tax values are plain 2-decimal strings.

Non-generic descriptions: rows 5 and 19 are "Office supplies, bulk" (224.04 / 5.55 and 800.40 / 29.74); the rest follow "item N".

Totals over rows 2–41: Amount sum = 20,090.42; Tax sum = 895.62. These are computed from the raw strings above (commas stripped) and were not verified against any sheet formula.

## 2. List every expense over 500, with how many there are and their total
Rule: Amount over 500

### Checked by code
- Rows where Amount > 500: 7, 9, 10, 14, 15, 19, 21, 22, 24, 26, 28, 30, 32, 33, 34, 37, 40, 41
- Count: 18
- Total: 13,206.91
