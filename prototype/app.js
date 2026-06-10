/* 감사내비 프로토타입 — 서버·DB 없이 localStorage만 사용 */
(function () {
  "use strict";

  var LS_CHECKS = "gamsanavi.checks.v1";   // { checkKey: true }
  var LS_BOARD  = "gamsanavi.board.v1";    // [{name, dept, owner, status}]

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  var checks = load(LS_CHECKS, {});
  var board  = load(LS_BOARD, []);
  var activeCat = CATEGORIES[0].id;
  var searchTerm = "";

  /* ───────── 공통 유틸 ───────── */
  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function checkKey(caseId, idx) { return caseId + "#" + idx; }

  function catProgress(catId) {
    var total = 0, done = 0;
    CASES.forEach(function (c) {
      if (c.cat !== catId) return;
      c.checks.forEach(function (_, i) {
        total++;
        if (checks[checkKey(c.id, i)]) done++;
      });
    });
    return { total: total, done: done };
  }

  /* ───────── 탭 전환 ───────── */
  document.querySelectorAll(".tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (b) { b.classList.remove("active"); });
      document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      $("#tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "status") renderStatus();
    });
  });

  /* ───────── 탭1: 분야별 자체점검 ───────── */
  function renderCats() {
    var html = "";
    CATEGORIES.forEach(function (cat) {
      var p = catProgress(cat.id);
      html += '<li data-cat="' + cat.id + '"' + (cat.id === activeCat && !searchTerm ? ' class="active"' : "") + ">" +
        '<span class="cat-prog">' + p.done + "/" + p.total + "</span>" +
        '<div class="cat-name">' + esc(cat.name) + "</div>" +
        '<div class="cat-desc">' + esc(cat.desc) + "</div></li>";
    });
    $("#cat-list").innerHTML = html;
    document.querySelectorAll("#cat-list li").forEach(function (li) {
      li.addEventListener("click", function () {
        activeCat = li.dataset.cat;
        searchTerm = "";
        $("#search").value = "";
        renderCats(); renderCases();
      });
    });
  }

  function matchesSearch(c, term) {
    var hay = (c.title + " " + c.detail + " " + c.basis + " " + c.checks.join(" ")).toLowerCase();
    return hay.indexOf(term.toLowerCase()) !== -1;
  }

  function renderCases() {
    var list = searchTerm
      ? CASES.filter(function (c) { return matchesSearch(c, searchTerm); })
      : CASES.filter(function (c) { return c.cat === activeCat; });

    if (!list.length) {
      $("#case-area").innerHTML = '<p class="empty">표시할 사례가 없습니다.</p>';
      return;
    }
    var html = "";
    list.forEach(function (c) {
      var catName = CATEGORIES.filter(function (k) { return k.id === c.cat; })[0].name;
      html += '<div class="case-card">' +
        '<div class="case-head"><h3>' + esc(c.title) +
        (c.verified === false ? '<span class="unverified">⚠ 원문 확인 전(예시)</span>' : "") +
        "</h3><span class=\"chip\">" + esc(c.disposition) + "</span></div>" +
        (searchTerm ? '<div class="case-docs" style="margin:2px 0 6px">분야: ' + esc(catName) + "</div>" : "") +
        '<p class="case-detail">' + esc(c.detail) + "</p>" +
        '<div class="case-basis">' + esc(c.basis) + "</div>" +
        '<div class="check-list">';
      c.checks.forEach(function (q, i) {
        var key = checkKey(c.id, i);
        var on = !!checks[key];
        html += '<label class="' + (on ? "done" : "") + '"><input type="checkbox" data-key="' + key + '"' +
          (on ? " checked" : "") + "><span>" + esc(q) + "</span></label>";
      });
      html += "</div>" +
        '<div class="case-docs">' + esc(c.docs.join(", ")) + "</div></div>";
    });
    $("#case-area").innerHTML = html;

    document.querySelectorAll('#case-area input[type="checkbox"]').forEach(function (box) {
      box.addEventListener("change", function () {
        if (box.checked) checks[box.dataset.key] = true;
        else delete checks[box.dataset.key];
        save(LS_CHECKS, checks);
        box.parentElement.classList.toggle("done", box.checked);
        renderCats();
      });
    });
  }

  $("#search").addEventListener("input", function () {
    searchTerm = this.value.trim();
    renderCats(); renderCases();
  });

  /* ───────── 탭2: 수감자료 보드 ───────── */
  var STATUSES = ["미시작", "진행중", "준비완료", "해당없음"];

  function renderBoard() {
    var fStatus = $("#board-status-filter").value;
    var fText = $("#board-search").value.trim().toLowerCase();
    var rows = "";
    board.forEach(function (item, idx) {
      if (fStatus && item.status !== fStatus) return;
      if (fText && (item.name + item.dept + item.owner).toLowerCase().indexOf(fText) === -1) return;
      var opts = STATUSES.map(function (s) {
        return '<option' + (s === item.status ? " selected" : "") + ">" + s + "</option>";
      }).join("");
      rows += '<tr class="st-' + item.status + '"><td>' + esc(item.name) + "</td><td>" + esc(item.dept) +
        "</td><td>" + esc(item.owner) + "</td>" +
        '<td><select data-idx="' + idx + '">' + opts + "</select></td>" +
        '<td class="no-print"><button class="del-btn" data-del="' + idx + '">✕</button></td></tr>';
    });
    $("#board-body").innerHTML = rows;
    $("#board-table").style.display = board.length ? "" : "none";
    $("#board-empty").style.display = board.length ? "none" : "";

    var done = board.filter(function (i) { return i.status === "준비완료" || i.status === "해당없음"; }).length;
    var pct = board.length ? Math.round(done / board.length * 100) : 0;
    $("#board-progress").innerHTML = board.length
      ? '<div class="progress-label">수감자료 준비율: ' + done + " / " + board.length + "건</div>" +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%">' + pct + "%</div></div>"
      : "";

    document.querySelectorAll("#board-body select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        board[+sel.dataset.idx].status = sel.value;
        save(LS_BOARD, board); renderBoard();
      });
    });
    document.querySelectorAll("#board-body .del-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        board.splice(+btn.dataset.del, 1);
        save(LS_BOARD, board); renderBoard();
      });
    });
  }

  $("#import-btn").addEventListener("click", function () {
    var lines = $("#paste-input").value.split(/\r?\n/);
    var added = 0;
    lines.forEach(function (line) {
      if (!line.trim()) return;
      var cols = line.split("\t");
      board.push({
        name: (cols[0] || "").trim(),
        dept: (cols[1] || "").trim(),
        owner: (cols[2] || "").trim(),
        status: "미시작"
      });
      added++;
    });
    if (added) {
      save(LS_BOARD, board);
      $("#paste-input").value = "";
      $("#paste-box").removeAttribute("open");
      renderBoard();
    }
  });

  $("#board-clear").addEventListener("click", function () {
    if (confirm("수감자료 목록을 전체 삭제할까요?")) {
      board = []; save(LS_BOARD, board); renderBoard();
    }
  });
  $("#board-status-filter").addEventListener("change", renderBoard);
  $("#board-search").addEventListener("input", renderBoard);

  function downloadCSV(filename, rows) {
    var csv = "\uFEFF" + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.download = filename;
    a.click();
  }

  $("#board-csv").addEventListener("click", function () {
    var rows = [["수감자료 항목", "담당부서", "담당자", "상태"]];
    board.forEach(function (i) { rows.push([i.name, i.dept, i.owner, i.status]); });
    downloadCSV("수감자료_준비현황.csv", rows);
  });

  /* ───────── 탭3: 진행 현황 ───────── */
  function renderStatus() {
    var html = '<div class="status-grid">';
    html += '<div class="status-card"><h4>분야별 자체점검 진행률</h4>';
    CATEGORIES.forEach(function (cat) {
      var p = catProgress(cat.id);
      var pct = p.total ? Math.round(p.done / p.total * 100) : 0;
      html += '<div class="progress-label">' + esc(cat.name) + " (" + p.done + "/" + p.total + ")</div>" +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%">' + pct + "%</div></div>";
    });
    html += "</div>";

    var done = board.filter(function (i) { return i.status === "준비완료" || i.status === "해당없음"; }).length;
    html += '<div class="status-card"><h4>수감자료 준비 현황</h4>';
    if (board.length) {
      STATUSES.forEach(function (s) {
        var n = board.filter(function (i) { return i.status === s; }).length;
        html += '<div class="progress-label">' + s + ": " + n + "건</div>";
      });
      var pct = Math.round(done / board.length * 100);
      html += '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%">' + pct + "%</div></div>";
    } else {
      html += '<p class="empty">수감자료 목록이 비어 있습니다.</p>';
    }
    html += "</div></div>";
    $("#status-area").innerHTML = html;
  }

  $("#reset-checks").addEventListener("click", function () {
    if (confirm("모든 점검 체크를 초기화할까요?")) {
      checks = {}; save(LS_CHECKS, checks);
      renderCats(); renderCases(); renderStatus();
    }
  });

  $("#check-csv").addEventListener("click", function () {
    var rows = [["분야", "지적사례", "점검 문항", "점검 여부"]];
    CASES.forEach(function (c) {
      var catName = CATEGORIES.filter(function (k) { return k.id === c.cat; })[0].name;
      c.checks.forEach(function (q, i) {
        rows.push([catName, c.title, q, checks[checkKey(c.id, i)] ? "완료" : "미점검"]);
      });
    });
    downloadCSV("자체점검_결과.csv", rows);
  });

  /* ───────── 인쇄 보고서 ───────── */
  $("#print-report").addEventListener("click", function () {
    var today = new Date();
    var dateStr = today.getFullYear() + "." + (today.getMonth() + 1) + "." + today.getDate() + ".";
    var html = "<h1>학교 종합감사 사전 자체점검 결과표</h1>" +
      '<p class="print-meta">점검일: ' + dateStr + " · 기준: " + esc(DATA_META.region) + " · 감사내비 프로토타입</p>";

    CATEGORIES.forEach(function (cat) {
      var catCases = CASES.filter(function (c) { return c.cat === cat.id; });
      if (!catCases.length) return;
      var p = catProgress(cat.id);
      html += "<h2>" + esc(cat.name) + " (" + p.done + "/" + p.total + ")</h2>" +
        "<table><tr><th style=\"width:30%\">지적사례 유형</th><th>점검 문항</th><th style=\"width:8%\">결과</th></tr>";
      catCases.forEach(function (c) {
        c.checks.forEach(function (q, i) {
          var on = !!checks[checkKey(c.id, i)];
          html += "<tr>" + (i === 0 ? '<td rowspan="' + c.checks.length + '">' + esc(c.title) + "</td>" : "") +
            "<td>" + esc(q) + "</td><td class=\"" + (on ? "ok\">점검" : "ng\">미점검") + "</td></tr>";
        });
      });
      html += "</table>";
    });

    if (board.length) {
      html += "<h2>수감자료 준비 현황</h2><table><tr><th>항목</th><th>담당부서</th><th>담당자</th><th>상태</th></tr>";
      board.forEach(function (i) {
        html += "<tr><td>" + esc(i.name) + "</td><td>" + esc(i.dept) + "</td><td>" + esc(i.owner) + "</td><td>" + esc(i.status) + "</td></tr>";
      });
      html += "</table>";
    }
    $("#print-area").innerHTML = html;
    window.print();
  });

  /* ───────── 초기화 ───────── */
  $("#meta-line").textContent =
    DATA_META.region + " · " + DATA_META.target + " · 데이터 기준일 " + DATA_META.updated +
    " · " + DATA_META.status;
  renderCats();
  renderCases();
  renderBoard();
})();
