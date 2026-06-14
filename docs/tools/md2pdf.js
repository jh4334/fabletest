const fs = require('fs');
const { chromium } = require(process.env.NODE_PATH + '/playwright');

const src = fs.readFileSync('/home/user/fabletest/docs/연구보고서_감사내비.md', 'utf8');
const lines = src.split('\n');

function inline(s) {
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  return s;
}
function toFileURL(src) {
  if (/^https?:|^data:/.test(src)) return src;
  // 자체 포함 PDF를 위해 이미지를 base64 데이터 URI로 인라인
  const abs = '/home/user/fabletest/docs/' + src.replace(/^\.?\//, '');
  const ext = (abs.match(/\.(\w+)$/) || [, 'png'])[1].toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return 'data:image/' + mime + ';base64,' + fs.readFileSync(abs).toString('base64');
}

let html = '', i = 0;
function flushPara(buf) { if (buf.trim()) html += '<p>' + inline(buf.trim()) + '</p>'; }

while (i < lines.length) {
  let line = lines[i];

  // 코드 블록
  if (line.trim().startsWith('```')) {
    let code = []; i++;
    while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i++; }
    i++;
    html += '<pre>' + code.join('\n').replace(/</g,'&lt;') + '</pre>';
    continue;
  }
  // 그림 (단독 줄: ![캡션](경로))
  let img = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (img) {
    html += '<figure><img src="' + toFileURL(img[2]) + '">' +
      (img[1] ? '<figcaption>' + inline(img[1]) + '</figcaption>' : '') + '</figure>';
    i++; continue;
  }
  // 제목
  let h = line.match(/^(#{1,4})\s+(.*)/);
  if (h) { html += '<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'; i++; continue; }
  // 수평선
  if (/^---+$/.test(line.trim())) { html += '<hr>'; i++; continue; }
  // 인용
  if (line.startsWith('>')) {
    let q = [];
    while (i < lines.length && lines[i].startsWith('>')) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
    html += '<blockquote>' + inline(q.join(' ')) + '</blockquote>';
    continue;
  }
  // 표
  if (line.trim().startsWith('|')) {
    let rows = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].trim()); i++; }
    const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    let t = '<table>';
    rows.forEach((r, idx) => {
      if (/^\|[\s:|-]+\|?$/.test(r) && idx === 1) return; // 구분선
      const tag = idx === 0 ? 'th' : 'td';
      t += '<tr>' + cells(r).map(c => '<' + tag + '>' + inline(c) + '</' + tag + '>').join('') + '</tr>';
    });
    t += '</table>';
    html += t;
    continue;
  }
  // 목록
  if (/^\s*[-*]\s+/.test(line)) {
    let items = [];
    while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
    html += '<ul>' + items.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>';
    continue;
  }
  if (/^\s*\d+\.\s+/.test(line)) {
    let items = [];
    while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
    html += '<ol>' + items.map(x => '<li>' + inline(x) + '</li>').join('') + '</ol>';
    continue;
  }
  // 빈 줄 / 문단
  if (!line.trim()) { i++; continue; }
  let para = [];
  while (i < lines.length && lines[i].trim() && !/^[#>|`]|^\s*[-*]\s|^\s*\d+\.\s|^---+$/.test(lines[i])) { para.push(lines[i]); i++; }
  flushPara(para.join(' '));
}

const doc = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>
@page { size: A4; margin: 20mm 18mm; }
body { font-family: "Noto Sans CJK KR","Malgun Gothic",sans-serif; font-size: 10.5pt; line-height: 1.65; color: #1a1a1a; }
h1 { font-size: 17pt; color: #1f3a5f; border-bottom: 3px solid #1f3a5f; padding-bottom: 6px; margin: 18px 0 12px; }
h2 { font-size: 13.5pt; color: #1f3a5f; border-left: 5px solid #1f3a5f; padding-left: 9px; margin: 20px 0 8px; page-break-after: avoid; }
h3 { font-size: 11.5pt; color: #2b4a73; margin: 14px 0 6px; page-break-after: avoid; }
h4 { font-size: 10.5pt; color: #2b4a73; margin: 10px 0 4px; }
p { margin: 6px 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #b9c2d0; padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: #eef2f8; color: #1f3a5f; }
ul, ol { margin: 6px 0; padding-left: 22px; }
li { margin: 3px 0; }
blockquote { background: #f3f6fb; border-left: 4px solid #8ba3c7; margin: 10px 0; padding: 8px 14px; color: #33415c; font-size: 10pt; }
pre { background: #f5f7fa; border: 1px solid #dde3ec; border-radius: 6px; padding: 10px 12px; font-family: Consolas,monospace; font-size: 9pt; white-space: pre-wrap; }
code { background: #eef1f6; border-radius: 3px; padding: 1px 4px; font-family: Consolas,monospace; font-size: 9.2pt; }
hr { border: 0; border-top: 1px solid #ccd; margin: 14px 0; }
strong { color: #14233a; }
figure { margin: 12px 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; border: 1px solid #d3d9e3; border-radius: 4px; }
figcaption { font-size: 9pt; color: #667; margin-top: 5px; }
</style></head><body>${html}</body></html>`;

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setContent(doc, { waitUntil: 'networkidle' });
  await p.pdf({ path: '/home/user/fabletest/docs/연구보고서_감사내비.pdf',
    format: 'A4', printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;text-align:center;font-size:8pt;color:#888;">감사내비 연구보고서 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  await b.close();
  console.log('PDF 생성 완료');
})();

// 검증용 스크린샷
(async () => {
  const { chromium } = require(process.env.NODE_PATH + '/playwright');
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 820, height: 1100 } });
  await p.setContent(doc, { waitUntil: 'networkidle' });
  // 그림1이 포함된 구간 캡처
  const fig = await p.$('figure img');
  if (fig) await fig.screenshot({ path: '/tmp/shots/report-fig-check.png' });
  // 분석 표 구간
  await p.evaluate(() => { const t=[...document.querySelectorAll('table')].find(x=>x.innerText.includes('학교회계 집행')); if(t) t.scrollIntoView(); });
  await p.screenshot({ path: '/tmp/shots/report-table-check.png' });
  await b.close();
  console.log('검증 스크린샷 완료');
})();
