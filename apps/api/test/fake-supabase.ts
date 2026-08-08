// A tiny in-memory stand-in for the Supabase JS client, just enough to run the
// analytics lib against. Unlike a blanket mock that returns whatever you hand
// it, this one actually APPLIES the .eq()/.gte()/.not()/.or() filters the code
// builds — so if a query forgot to scope by client_id, the other tenant's rows
// would come back and the leakage test would fail. That's the whole point.

type Row = Record<string, any>
type Pred = (r: Row) => boolean

interface SelectOpts { count?: 'exact'; head?: boolean }

class Query implements PromiseLike<{ data: Row[] | null; count: number | null; error: null }> {
  private preds: Pred[] = []
  private orderings: { col: string; asc: boolean }[] = []
  private limitN: number | null = null
  private wantCount = false
  private head = false
  private single = false

  constructor(private rows: Row[]) {}

  select(_cols?: string, opts?: SelectOpts) {
    if (opts?.count) this.wantCount = true
    if (opts?.head) this.head = true
    return this
  }
  eq(col: string, val: any) { this.preds.push(r => r[col] === val); return this }
  gte(col: string, val: any) { this.preds.push(r => r[col] >= val); return this }
  lte(col: string, val: any) { this.preds.push(r => r[col] <= val); return this }
  gt(col: string, val: any) { this.preds.push(r => r[col] > val); return this }
  lt(col: string, val: any) { this.preds.push(r => r[col] < val); return this }
  // Supports the one form the code uses: .not('col', 'is', null).
  not(col: string, _op: string, val: any) { this.preds.push(r => r[col] !== val); return this }
  // Parses "escalated.eq.true,confidence.lt.0.7" into an OR of simple predicates.
  or(filter: string) {
    const clauses = filter.split(',').map(part => {
      // Split on only the first two dots — the value itself may contain one
      // (e.g. "confidence.lt.0.7").
      const i1 = part.indexOf('.')
      const i2 = part.indexOf('.', i1 + 1)
      const col = part.slice(0, i1)
      const op = part.slice(i1 + 1, i2)
      const raw = part.slice(i2 + 1)
      const val = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : Number.isNaN(Number(raw)) ? raw : Number(raw)
      return (r: Row): boolean => {
        switch (op) {
          case 'eq': return r[col] === val
          case 'lt': return r[col] !== null && r[col] !== undefined && r[col] < (val as number)
          case 'gt': return r[col] !== null && r[col] !== undefined && r[col] > (val as number)
          default: return false
        }
      }
    })
    this.preds.push(r => clauses.some(c => c(r)))
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) { this.orderings.push({ col, asc: opts?.ascending ?? true }); return this }
  limit(n: number) { this.limitN = n; return this }
  singleRow() { this.single = true; return this }

  private resolve() {
    let out = this.rows.filter(r => this.preds.every(p => p(r)))
    // Apply orderings last-to-first for a stable multi-key sort.
    for (const o of [...this.orderings].reverse()) {
      out = [...out].sort((a, b) => (a[o.col] < b[o.col] ? -1 : a[o.col] > b[o.col] ? 1 : 0) * (o.asc ? 1 : -1))
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN)
    if (this.wantCount) return { data: this.head ? null : out, count: out.length, error: null as null }
    if (this.single) return { data: (out[0] ?? null) as any, count: null, error: out.length ? null : ({ code: 'PGRST116' } as any) }
    return { data: out, count: null, error: null as null }
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; count: number | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled as any, onrejected)
  }
}

// `.single()` in supabase-js is a terminal that returns a thenable; expose it
// as a method that flips the flag then returns the query (still awaitable).
;(Query.prototype as any).single = function () { return this.singleRow() }

export function buildFakeSupabase(seed: Record<string, Row[]>) {
  return {
    from(table: string) {
      return new Query(seed[table] ?? [])
    },
    rpc() {
      // Analytics never calls rpc; searchDocs does, but that's not under test.
      return Promise.resolve({ data: [], error: null })
    }
  }
}
