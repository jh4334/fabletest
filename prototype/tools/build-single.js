/* 감사내비 단일 파일 빌드 — index.html + style.css + data.js + app.js 를
   하나의 '감사내비.html'로 합쳐 이메일·USB로 파일 하나만 배포할 수 있게 한다.
   실행:  node tools/build-single.js   (prototype 폴더에서)
   결과:  ../dist/감사내비.html */
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");        // prototype/
var read = function (f) { return fs.readFileSync(path.join(root, f), "utf8"); };

var html = read("index.html");
var css  = read("style.css");
var data = read("data.js");
var app  = read("app.js");

// <link rel="stylesheet" href="style.css"> → 인라인 <style>
html = html.replace(/<link[^>]*href="style\.css"[^>]*>/,
  "<style>\n" + css + "\n</style>");

// <script src="data.js"></script> + <script src="app.js"></script> → 인라인
html = html.replace(/<script src="data\.js"><\/script>\s*<script src="app\.js"><\/script>/,
  "<script>\n" + data + "\n</script>\n<script>\n" + app + "\n</script>");

// 배포본임을 알리는 주석
html = html.replace(/<head>/,
  "<head>\n<!-- 감사내비 단일 파일 배포본 (자동 생성: tools/build-single.js). " +
  "원본 수정은 prototype/ 의 분리 파일에서 하세요. -->");

var outDir = path.resolve(root, "..", "dist");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
var outPath = path.join(outDir, "감사내비.html");
fs.writeFileSync(outPath, html, "utf8");

var kb = Math.round(Buffer.byteLength(html, "utf8") / 1024);
console.log("생성 완료: dist/감사내비.html (" + kb + " KB)");
// 인라인 누락 검증
["style.css", "data.js", "app.js"].forEach(function (f) {
  if (html.indexOf('href="' + f + '"') !== -1 || html.indexOf('src="' + f + '"') !== -1) {
    console.error("경고: " + f + " 가 인라인되지 않았습니다.");
    process.exit(1);
  }
});
if (html.indexOf("const CASES") === -1 || html.indexOf("function renderDash") === -1) {
  console.error("경고: 데이터/스크립트 인라인 확인 실패.");
  process.exit(1);
}
console.log("검증 통과: 외부 파일 참조 없음, 데이터·스크립트 포함.");
