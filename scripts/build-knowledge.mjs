// Node 24 only. Offline, streaming, resumable index; never executes corpus code.
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { createGunzip, createZstdDecompress, zstdCompressSync, constants } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = '1';
export const TOPICS = ['overview', 'personality', 'love', 'career', 'wealth', 'health', 'family', 'children', 'move', 'friends', 'home', 'spirit', 'parents'];
function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
async function* binaryLines(stream) {
  let fragments = []; let size = 0;
  for await (const chunk of stream) {
    let start = 0; let end;
    while ((end = chunk.indexOf(10, start)) >= 0) {
      const part = chunk.subarray(start, end);
      yield fragments.length ? Buffer.concat([...fragments, part], size + part.length) : part;
      fragments = []; size = 0; start = end + 1;
    }
    if (start < chunk.length) { const part = chunk.subarray(start); fragments.push(part); size += part.length; }
    if (size > 8 * 1024 * 1024) throw new Error('Unexpectedly large source record');
  }
  if (size) yield Buffer.concat(fragments, size);
}
export async function buildKnowledge(root, output, { fixture = false } = {}) {
  const startedAt = new Date().toISOString();
  mkdirSync(path.dirname(output), { recursive: true });
  const temporary = output + '.building';
  const db = new DatabaseSync(temporary);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-32768;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources(path TEXT PRIMARY KEY,bytes INTEGER NOT NULL,rows INTEGER NOT NULL,invalid INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS days(version TEXT NOT NULL,date TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(version,date)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS passages(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,text TEXT NOT NULL,url TEXT NOT NULL,license TEXT NOT NULL,locator TEXT NOT NULL);
  `);
  const setMeta = db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)');
  const previous = db.prepare("SELECT value FROM meta WHERE key='schema'").get()?.value;
  if (previous && previous !== SCHEMA_VERSION) throw new Error('Index schema mismatch; choose a new output path');
  setMeta.run('schema', SCHEMA_VERSION); setMeta.run('startedAt', startedAt);
  const saveDay = db.prepare('INSERT INTO days VALUES(?,?,?)');
  const saveSource = db.prepare('INSERT INTO sources VALUES(?,?,?,?)');
  const scanRoots = [
    ['v3', path.join(root, 'original/v3.0-samples/expanded/ziwei-samples-toolkit/samples-out'), '.jsonl.gz'],
    ['v4', path.join(root, 'original/v4.0-13d/years'), '.jsonl.zst'],
  ];
  let completed = 0;
  try {
    for (const [version, directory, suffix] of scanRoots) {
      const files = readdirSync(directory, { recursive: true }).filter(name => name.endsWith(suffix)).sort();
      if (!fixture && files.length !== (version === 'v3' ? 720 : 77)) throw new Error(`Incomplete ${version} source corpus`);
      for (const name of files) {
        const file = path.join(directory, name); const key = path.relative(root, file).replaceAll(path.sep, '/');
        const bytes = statSync(file).size;
        const done = db.prepare('SELECT bytes FROM sources WHERE path=?').get(key);
        if (done) { if (done.bytes !== bytes) throw new Error('Source changed after indexing'); continue; }
        let currentDate = ''; let records = []; let seen = new Set(); let count = 0; let invalid = 0;
        const flush = () => {
          if (!records.length) return;
          if (!fixture && records.length !== 24) throw new Error(`Incomplete day ${version} ${currentDate}`);
          if (seen.size !== records.length) throw new Error('Duplicate birth key');
          const payload = zstdCompressSync(Buffer.concat(records.flatMap(line => [line, Buffer.from('\n')])), { params: { [constants.ZSTD_c_compressionLevel]: 1 } });
          saveDay.run(version, currentDate, payload); records = []; seen = new Set();
        };
        db.exec('BEGIN');
        try {
          const input = createReadStream(file);
          const decompressor = version === 'v3' ? createGunzip({ chunkSize: 1024 * 1024 }) : createZstdDecompress({ chunkSize: 1024 * 1024, params: { [constants.ZSTD_d_windowLogMax]: 27 } });
          input.on('error', error => decompressor.destroy(error));
          try {
            for await (const line of binaryLines(input.pipe(decompressor))) {
              if (!line.length) continue;
              // Keep the original UTF-8 bytes. Parse only the small metadata header,
              // instead of repeatedly decoding/re-encoding 90 GB of topic bodies.
              const marker = version === 'v3' ? ',"chart":' : ',"c":';
              let cut = line.indexOf(marker);
              if (cut < 0) cut = line.indexOf(version === 'v3' ? ', "chart":' : ', "c":');
              const raw = cut >= 0 ? JSON.parse(line.subarray(0, cut).toString('utf8') + '}') : JSON.parse(line.toString('utf8'));
              const birth = version === 'v3' ? raw.birthInfo : { year: raw.y, month: raw.m, day: raw.d, hour: raw.h, gender: raw.g };
              if (!validDate(birth.year, birth.month, birth.day)) { invalid++; continue; }
              if (!Number.isInteger(birth.hour) || birth.hour < 0 || birth.hour > 11 || !['male', 'female'].includes(birth.gender)) throw new Error('Invalid birth schema');
              if (count === 0) {
                const full = JSON.parse(line.toString('utf8')); const topics = version === 'v3' ? full.topics : full.c;
                if (!topics || TOPICS.some(topic => typeof topics[topic] !== 'string' || !topics[topic])) throw new Error('Missing first-record topic');
              }
              const date = `${birth.year}-${String(birth.month).padStart(2, '0')}-${String(birth.day).padStart(2, '0')}`;
              if (date !== currentDate) { flush(); currentDate = date; }
              const birthKey = `${birth.hour}-${birth.gender}`;
              if (seen.has(birthKey)) throw new Error('Duplicate birth key');
              seen.add(birthKey); records.push(Buffer.from(line)); count++;
            }
            flush();
          } finally { input.destroy(); decompressor.destroy(); }
          saveSource.run(key, bytes, count, invalid); db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        completed++;
        if (completed % 12 === 0 || version === 'v4') console.log(JSON.stringify({ version, file: name, filesCompleted: completed, rows: count, invalid, indexGB: +(statSync(temporary).size / 1e9).toFixed(3) }));
      }
    }
    db.exec('BEGIN; DELETE FROM passages;');
    const insert = db.prepare('INSERT INTO passages VALUES(?,?,?,?,?,?,?)');
    const books = JSON.parse(readFileSync(path.join(root, 'resources/classics.json'), 'utf8'));
    for (const book of books) for (const [chapterIndex, chapter] of book.chapters.entries()) for (const passage of chapter.paragraphs) {
      insert.run(`classic:${passage.id}`, 'classic', `《${book.title}》·${chapter.title}`, passage.text,
        `/library/${book.slug}/${chapterIndex}#${passage.id}`, '仓库古籍整理；公版原文，整理遵循仓库许可', passage.id);
    }
    const quotes = readFileSync(path.join(root, 'resources/tianji/entries.jsonl'), 'utf8').trim().split(/\r?\n/);
    for (const [index, line] of quotes.entries()) {
      const quote = JSON.parse(line);
      if (!quote.quote || !quote.bvid || !/^BV[A-Za-z0-9]+$/.test(quote.bvid)) continue;
      const seconds = String(quote.t_hms || '00:00:00').split(':').reduce((sum, n) => sum * 60 + Number(n), 0);
      const locator = `${quote.book} / ${quote.h2 || ''} / ${quote.h3 || ''} / ${quote.t_hms}`;
      insert.run(`tianji:${index + 1}`, 'tianji', `倪海厦《天纪》·${quote.h2 || quote.book}`, quote.quote,
        `https://www.bilibili.com/video/${quote.bvid}/?p=${Number(quote.part) || 1}&t=${seconds}`, 'CC BY-NC-SA 4.0；仅非商业使用，署名及相同方式共享', locator);
    }
    db.exec('COMMIT');
    const totals = db.prepare('SELECT SUM(rows) rows,SUM(invalid) invalid,COUNT(*) files FROM sources').get();
    if (!fixture && (totals.rows !== 1190856 || totals.invalid !== 2520 || totals.files !== 797)) throw new Error(`Unexpected totals: ${JSON.stringify(totals)}`);
    const report = { schema: SCHEMA_VERSION, startedAt, completedAt: new Date().toISOString(), ...totals,
      days: db.prepare('SELECT count(*) n FROM days').get().n, passages: db.prepare('SELECT count(*) n FROM passages').get().n,
      perVersion: db.prepare("SELECT substr(path,10,2) version,SUM(rows) rows,SUM(invalid) invalid FROM sources GROUP BY substr(path,10,2)").all() };
    setMeta.run('report', JSON.stringify(report)); setMeta.run('ready', 'true');
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Index integrity check failed');
    db.close(); renameSync(temporary, output);
    console.log(JSON.stringify({ ready: true, output, ...report }));
    return report;
  } catch (error) { db.close(); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(process.argv[2] || 'knowledge');
  const output = path.resolve(process.argv[3] || path.join(root, 'index/knowledge.sqlite'));
  if (existsSync(output)) throw new Error('Choose a new output filename; keep the active index intact');
  buildKnowledge(root, output, { fixture: process.env.KNOWLEDGE_FIXTURE === 'true' }).catch(error => { console.error(error); process.exitCode = 1; });
}
