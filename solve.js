// Fast drop-in for csv-reader 1.0.0 (v4): regex test() instead of exec().
// Same exact semantics as solve.js; see it for the policy comments.
// test() with a /g regex scans the same way exec() does but allocates no
// match array; the matched character sits at lastIndex - 1.

/** First of: a double-quote, a carriage return, or a line feed. */
const REC = /["\r\n]/g;
/** Next field delimiter for an unquoted field. */
const DELIM = /[,\r\n]/g;

/** How a field ended: 0 comma, 1 line break, 2 end of text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field
  // and how it ended; `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    let parts = null; // kept pieces, only when a stray CR forces a join
    let cur = value;
    for (;;) {
      DELIM.lastIndex = pos;
      if (!DELIM.test(text)) {
        const tail = text.slice(pos);
        pos = len;
        return { value: parts !== null ? parts.join('') + cur + tail : cur + tail, ended: END, added: added + tail.length };
      }
      const idx = DELIM.lastIndex - 1;
      const ch = text[idx];
      if (ch === ',') {
        const piece = text.slice(pos, idx);
        pos = idx + 1;
        return { value: parts !== null ? parts.join('') + cur + piece : cur + piece, ended: COMMA, added: added + piece.length };
      }
      if (ch === '\n') {
        const piece = text.slice(pos, idx);
        pos = idx + 1;
        line += 1;
        return { value: parts !== null ? parts.join('') + cur + piece : cur + piece, ended: LINE_BREAK, added: added + piece.length };
      }
      // ch === '\r'
      if (text[idx + 1] === '\n') {
        const piece = text.slice(pos, idx);
        pos = idx + 2;
        line += 1;
        return { value: parts !== null ? parts.join('') + cur + piece : cur + piece, ended: LINE_BREAK, added: added + piece.length };
      }
      // Lone CR: dropped, reported, the field goes on.
      error('stray_cr');
      const piece = text.slice(pos, idx);
      if (parts !== null) {
        parts.push(cur, piece);
      } else {
        parts = [cur, piece];
      }
      cur = '';
      added += piece.length;
      pos = idx + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      let chunk = text.slice(pos, q);
      if (chunk.indexOf('\n') !== -1 || chunk.indexOf('\r') !== -1) {
        // CRLF and a lone CR inside quotes are each one LF, in the value
        // and in the line count.
        let add = 0;
        let j = -1;
        while ((j = chunk.indexOf('\n', j + 1)) !== -1) add += 1;
        j = -1;
        while ((j = chunk.indexOf('\r', j + 1)) !== -1) {
          if (chunk[j + 1] !== '\n') add += 1;
        }
        line += add;
        if (chunk.indexOf('\r') !== -1) chunk = chunk.replace(/\r\n?/g, '\n');
      }
      value += chunk;
      if (text[q + 1] === '"') {
        // A doubled quote is one quote, and the field goes on.
        value += '"';
        pos = q + 2;
        continue;
      }
      // Closing quote.
      pos = q + 1;
      if (pos >= len) return { value, ended: END };
      const c = text[pos];
      if (c === ',') {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === '\n') {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) error('quote_junk');
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the next of quote, CR or LF decides the record. A quote
    // before any line break, or a CR not followed by LF, needs the slow
    // path; a line break (LF, or CR followed by LF) with neither before it
    // means the record is plain: slice it whole and split on commas.
    REC.lastIndex = pos;
    let fields;
    let slow = false;
    let recEnd = len; // where the record's text ends
    let recEnded = END;
    if (!REC.test(text)) {
      recEnd = len;
      recEnded = END;
    } else {
      const ridx = REC.lastIndex - 1;
      const rch = text[ridx];
      if (rch === '"') {
        slow = true;
      } else if (rch === '\r') {
        if (text[ridx + 1] === '\n') {
          recEnd = ridx;
          recEnded = LINE_BREAK;
        } else {
          slow = true;
        }
      } else {
        // '\n'
        recEnd = ridx;
        recEnded = LINE_BREAK;
      }
    }

    if (slow) {
      fields = [];
      let field;
      let quoted;
      do {
        quoted = text[pos] === '"';
        field = quoted ? readQuoted() : readUnquoted('');
        fields.push(field.value);
      } while (field.ended === COMMA);

      // A line that held only stray CRs is left with no characters: no
      // record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    } else {
      fields = text.slice(pos, recEnd).split(',');
      if (recEnded === LINE_BREAK) {
        pos = recEnd + (text.charCodeAt(recEnd) === 13 ? 2 : 1);
        line += 1;
      } else {
        pos = len;
      }
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
