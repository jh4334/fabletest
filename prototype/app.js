/* 감사내비 프로토타입 v2 — 서버·DB 없이 localStorage만 사용 */
(function () {
  "use strict";

  var LS_CHECKS   = "gamsanavi.checks.v1";    // { checkKey: true }
  var LS_BOARD    = "gamsanavi.board.v1";     // [{name, dept, owner, status}]
  var LS_NA       = "gamsanavi.na.v1";        // { caseId: true }  해당없음 처리
  var LS_MEMO     = "gamsanavi.memo.v1";      // { caseId: "메모" }
  var LS_SETTINGS = "gamsanavi.settings.v1";  // { school, auditDate }

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  var checks   = load(LS_CHECKS, {});
  var board    = load(LS_BOARD, []);
  var naCases  = load(LS_NA, {});
  var memos    = load(LS_MEMO, {});
  var settings = load(LS_SETTINGS, { school: "", auditDate: "" });
  var activeCat = CATEGORIES[0].id;
  var searchTerm = "";

  /* ───────── 공통 유틸 ───────── */
  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function catById(id) {
    return CATEGORIES.filter(function (k) { return k.id === id; })[0];
  }
  function checkKey(caseId, idx) { return caseId + "#" + idx; }
  function caseDone(c) {
    return c.checks.every(function (_, i) { return checks[checkKey(c.id, i)]; });
  }

  /* 해당없음 처리된 사례는 진행률 분모에서 제외 */
  function catProgress(catId) {
    var total = 0, done = 0;
    CASES.forEach(function (c) {
      if (c.cat !== catId || naCases[c.id]) return;
      c.checks.forEach(function (_, i) {
        total++;
        if (checks[checkKey(c.id, i)]) done++;
      });
    });
    return { total: total, done: done };
  }
  function totalProgress() {
    var t = 0, d = 0;
    CATEGORIES.forEach(function (cat) {
      var p = catProgress(cat.id);
      t += p.total; d += p.done;
    });
    return { total: t, done: d };
  }
  function boardProgress() {
    var done = board.filter(function (i) {
      return i.status === "준비완료" || i.status === "해당없음";
    }).length;
    return { total: board.length, done: done };
  }
  function pctClass(pct) { return pct >= 70 ? "" : (pct >= 40 ? "warn" : "low"); }
  function progressBarHTML(pct) {
    return '<div class="progress-bar"><div class="progress-fill ' + pctClass(pct) +
      '" style="width:' + pct + '%">' + pct + "%</div></div>";
  }

  /* ───────── 탭 전환 ───────── */
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "tab-" + name);
    });
    if (name === "dash") renderDash();
    if (name === "stats") renderStats();
  }
  document.querySelectorAll(".tab").forEach(function (btn) {
    btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
  });

  /* ───────── 탭0: 대시보드 ───────── */
  function renderDash() {
    // D-day
    var dEl = $("#dday-big"), dateEl = $("#dday-date");
    if (settings.auditDate) {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var target = new Date(settings.auditDate + "T00:00:00");
      var diff = Math.round((target - today) / 86400000);
      var label = diff > 0 ? "D-" + diff : (diff === 0 ? "D-day" : "D+" + (-diff));
      dEl.textContent = label;
      dEl.className = "dday-big " + (diff > 90 ? "far" : (diff > 30 ? "mid" : ""));
      dateEl.textContent = (settings.school ? settings.school + " · " : "") +
        "감사 예정일 " + settings.auditDate;
    } else {
      dEl.textContent = "D-?";
      dEl.className = "dday-big far";
      dateEl.textContent = "학교명과 감사 예정일을 입력하세요";
    }
    $("#set-school").value = settings.school || "";
    $("#set-date").value = settings.auditDate || "";

    // 종합 준비도 = 자체점검 진행률과 수감자료 준비율의 평균(수감자료 없으면 점검만)
    var cp = totalProgress(), bp = boardProgress();
    var checkPct = cp.total ? Math.round(cp.done / cp.total * 100) : 0;
    var boardPct = bp.total ? Math.round(bp.done / bp.total * 100) : null;
    var scorePct = boardPct === null ? checkPct : Math.round((checkPct + boardPct) / 2);
    $("#dash-score").textContent = scorePct + "%";
    $("#dash-score-detail").innerHTML =
      "자체점검 " + cp.done + "/" + cp.total + "문항 (" + checkPct + "%)<br>" +
      (boardPct === null ? "수감자료 목록 미등록" :
        "수감자료 " + bp.done + "/" + bp.total + "건 (" + boardPct + "%)");

    // 분야별 현황 (진행률 낮은 순)
    var rows = CATEGORIES.map(function (cat) {
      var p = catProgress(cat.id);
      var pct = p.total ? Math.round(p.done / p.total * 100) : 100;
      return { cat: cat, p: p, pct: pct };
    }).sort(function (a, b) { return a.pct - b.pct; });
    $("#dash-cats").innerHTML = rows.map(function (r) {
      return '<div class="dash-cat-row" data-goto="' + r.cat.id + '">' +
        '<span class="dc-name">' + esc(r.cat.name) + "</span>" +
        '<span class="dc-bar">' + progressBarHTML(r.pct) + "</span>" +
        '<span class="dc-num">' + r.p.done + "/" + r.p.total + "</span></div>";
    }).join("");
    document.querySelectorAll("#dash-cats [data-goto]").forEach(function (el) {
      el.addEventListener("click", function () {
        activeCat = el.dataset.goto;
        searchTerm = ""; $("#search").value = "";
        renderCats(); renderCases(); switchTab("check");
      });
    });

    // 추천 점검: 빈출(freq>=3) 사례 중 미완료·해당없음 아닌 것
    var todos = CASES.filter(function (c) {
      return (c.freq || 0) >= 3 && !naCases[c.id] && !caseDone(c);
    }).slice(0, 6);
    $("#dash-todo").innerHTML = todos.length
      ? todos.map(function (c) {
          return '<li data-goto="' + c.cat + '">★ ' + esc(c.title) +
            '<span class="todo-cat">' + esc(catById(c.cat).name) + "</span></li>";
        }).join("")
      : '<li class="all-done">✔ 빈출 사례 점검을 모두 마쳤습니다. 분야별 점검을 이어가세요.</li>';
    document.querySelectorAll("#dash-todo li[data-goto]").forEach(function (el) {
      el.addEventListener("click", function () {
        activeCat = el.dataset.goto;
        searchTerm = ""; $("#search").value = "";
        renderCats(); renderCases(); switchTab("check");
      });
    });
  }

  $("#save-settings").addEventListener("click", function () {
    settings.school = $("#set-school").value.trim();
    settings.auditDate = $("#set-date").value;
    save(LS_SETTINGS, settings);
    renderDash();
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
      var isNA = !!naCases[c.id];
      var memo = memos[c.id] || "";
      html += '<div class="case-card' + (isNA ? " is-na" : "") + '" id="card-' + c.id + '">' +
        '<div class="case-head"><div><h3>' + esc(c.title) + "</h3>" +
        (c.verified === false ? '<span class="unverified">⚠ 원문 확인 전(예시)</span>' : "") +
        "</div><div class=\"head-chips\">" +
        ((c.freq || 0) >= 3 ? '<span class="chip freq">★ 빈출</span>' : "") +
        '<span class="chip">' + esc(c.disposition) + "</span></div></div>" +
        (searchTerm ? '<div class="case-docs" style="margin:2px 0 6px">분야: ' + esc(catById(c.cat).name) + "</div>" : "") +
        '<p class="case-detail">' + esc(c.detail) + "</p>" +
        '<div class="case-basis">' + esc(c.basis) + "</div>" +
        '<div class="check-list">';
      c.checks.forEach(function (q, i) {
        var key = checkKey(c.id, i);
        var on = !!checks[key];
        html += '<label class="' + (on ? "done" : "") + '"><input type="checkbox" data-key="' + key + '"' +
          (on ? " checked" : "") + (isNA ? " disabled" : "") + "><span>" + esc(q) + "</span></label>";
      });
      html += "</div>" +
        '<div class="case-docs">' + esc(c.docs.join(", ")) + "</div>" +
        '<div class="case-foot">' +
        '<span class="na-toggle" data-na="' + c.id + '">' + (isNA ? "↩ 점검 대상으로 되돌리기" : "해당없음(우리 학교 무관)") + "</span>" +
        '<span class="memo-toggle' + (memo ? " has-memo" : "") + '" data-memo="' + c.id + '">✎ 메모' + (memo ? " 있음" : "") + "</span>" +
        "</div>" +
        '<textarea class="case-memo" data-memo-input="' + c.id + '" placeholder="담당자 메모 (확인한 문서, 후임자에게 남길 말 등)" ' +
        (memo ? "" : "hidden ") + "rows=\"2\">" + esc(memo) + "</textarea>" +
        "</div>";
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
    document.querySelectorAll("#case-area .na-toggle").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = el.dataset.na;
        if (naCases[id]) delete naCases[id];
        else naCases[id] = true;
        save(LS_NA, naCases);
        renderCats(); renderCases();
      });
    });
    document.querySelectorAll("#case-area .memo-toggle").forEach(function (el) {
      el.addEventListener("click", function () {
        var ta = document.querySelector('[data-memo-input="' + el.dataset.memo + '"]');
        ta.hidden = !ta.hidden;
        if (!ta.hidden) ta.focus();
      });
    });
    document.querySelectorAll("#case-area .case-memo").forEach(function (ta) {
      ta.addEventListener("input", function () {
        var id = ta.dataset.memoInput;
        var val = ta.value.trim();
        if (val) memos[id] = val;
        else delete memos[id];
        save(LS_MEMO, memos);
        var toggle = document.querySelector('[data-memo="' + id + '"]');
        toggle.classList.toggle("has-memo", !!val);
        toggle.textContent = val ? "✎ 메모 있음" : "✎ 메모";
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
        '<td class="no-print"><button class="del-btn" data-del="' + idx + '" title="삭제">✕</button></td></tr>';
    });
    $("#board-body").innerHTML = rows;
    $("#board-table").style.display = board.length ? "" : "none";
    $("#board-empty").style.display = board.length ? "none" : "";

    var bp = boardProgress();
    var pct = bp.total ? Math.round(bp.done / bp.total * 100) : 0;
    $("#board-progress").innerHTML = bp.total
      ? '<div class="progress-label">수감자료 준비율: ' + bp.done + " / " + bp.total + "건</div>" + progressBarHTML(pct)
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

  /* ───────── CSV / 백업 ───────── */
  function downloadFile(filename, content, mime) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function downloadCSV(filename, rows) {
    var csv = "\uFEFF" + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    downloadFile(filename, csv, "text/csv;charset=utf-8;");
  }

  $("#board-csv").addEventListener("click", function () {
    var rows = [["수감자료 항목", "담당부서", "담당자", "상태"]];
    board.forEach(function (i) { rows.push([i.name, i.dept, i.owner, i.status]); });
    downloadCSV("수감자료_준비현황.csv", rows);
  });

  $("#check-csv").addEventListener("click", function () {
    var rows = [["분야", "지적사례", "점검 문항", "점검 여부", "메모"]];
    CASES.forEach(function (c) {
      var catName = catById(c.cat).name;
      c.checks.forEach(function (q, i) {
        rows.push([catName, c.title, q,
          naCases[c.id] ? "해당없음" : (checks[checkKey(c.id, i)] ? "완료" : "미점검"),
          i === 0 ? (memos[c.id] || "") : ""]);
      });
    });
    downloadCSV("자체점검_결과.csv", rows);
  });

  $("#backup-btn").addEventListener("click", function () {
    var payload = {
      app: "gamsanavi", version: 2, exportedAt: new Date().toISOString(),
      settings: settings, checks: checks, board: board, na: naCases, memos: memos
    };
    var name = "감사내비_백업_" + new Date().toISOString().slice(0, 10) + ".json";
    downloadFile(name, JSON.stringify(payload, null, 2), "application/json");
  });

  $("#restore-btn").addEventListener("click", function () { $("#restore-file").click(); });
  $("#restore-file").addEventListener("change", function () {
    var file = this.files[0];
    this.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var payload;
      try { payload = JSON.parse(reader.result); } catch (e) { payload = null; }
      if (!payload || payload.app !== "gamsanavi") {
        alert("감사내비 백업 파일이 아닙니다.");
        return;
      }
      if (!confirm("백업 파일로 현재 데이터를 덮어쓸까요?\n(내보낸 시점: " + (payload.exportedAt || "알 수 없음") + ")")) return;
      checks   = payload.checks || {};
      board    = Array.isArray(payload.board) ? payload.board : [];
      naCases  = payload.na || {};
      memos    = payload.memos || {};
      settings = payload.settings || { school: "", auditDate: "" };
      save(LS_CHECKS, checks); save(LS_BOARD, board); save(LS_NA, naCases);
      save(LS_MEMO, memos); save(LS_SETTINGS, settings);
      renderCats(); renderCases(); renderBoard(); renderDash(); renderStats();
      alert("복원이 완료되었습니다.");
    };
    reader.readAsText(file, "utf-8");
  });

  /* ───────── 탭3: 통계·보고서 ───────── */
  function dispositionGroup(d) {
    if (d.indexOf("회수") !== -1 || d.indexOf("시정") !== -1) return "시정·회수(금전)";
    if (d.indexOf("경고") !== -1) return "경고";
    return "주의 등";
  }

  function renderStats() {
    var html = '<div class="status-grid">';

    // 분야별 사례 분포 (데이터 분석 관점)
    var counts = CATEGORIES.map(function (cat) {
      return { name: cat.name, n: CASES.filter(function (c) { return c.cat === cat.id; }).length };
    }).sort(function (a, b) { return b.n - a.n; });
    var maxN = counts[0] ? counts[0].n : 1;
    html += '<div class="status-card"><h4>분야별 지적사례 분포 (수록 ' + CASES.length + "건)</h4>";
    counts.forEach(function (r) {
      html += '<div class="bar-row"><span class="bar-name">' + esc(r.name) + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="display:block;width:' + Math.round(r.n / maxN * 100) + '%"></span></span>' +
        '<span class="bar-num">' + r.n + "건</span></div>";
    });
    html += "</div>";

    // 처분 유형 분포
    var groups = {};
    CASES.forEach(function (c) {
      var g = dispositionGroup(c.disposition);
      groups[g] = (groups[g] || 0) + 1;
    });
    var gRows = Object.keys(groups).map(function (g) { return { name: g, n: groups[g] }; })
      .sort(function (a, b) { return b.n - a.n; });
    var gMax = gRows[0] ? gRows[0].n : 1;
    html += '<div class="status-card"><h4>처분 유형 분포 — 금전 처분(회수)이 걸린 분야가 우선 점검 대상</h4>';
    gRows.forEach(function (r) {
      html += '<div class="bar-row"><span class="bar-name">' + esc(r.name) + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="display:block;width:' + Math.round(r.n / gMax * 100) + '%"></span></span>' +
        '<span class="bar-num">' + r.n + "건</span></div>";
    });
    html += "</div>";

    // 점검 진행률
    html += '<div class="status-card"><h4>분야별 자체점검 진행률</h4>';
    CATEGORIES.forEach(function (cat) {
      var p = catProgress(cat.id);
      var pct = p.total ? Math.round(p.done / p.total * 100) : 100;
      html += '<div class="progress-label">' + esc(cat.name) + " (" + p.done + "/" + p.total + ")</div>" + progressBarHTML(pct);
    });
    html += "</div>";

    // 수감자료 현황
    var bp = boardProgress();
    html += '<div class="status-card"><h4>수감자료 준비 현황</h4>';
    if (bp.total) {
      STATUSES.forEach(function (s) {
        var n = board.filter(function (i) { return i.status === s; }).length;
        html += '<div class="progress-label">' + s + ": " + n + "건</div>";
      });
      html += progressBarHTML(Math.round(bp.done / bp.total * 100));
    } else {
      html += '<p class="empty">수감자료 목록이 비어 있습니다.</p>';
    }
    html += "</div></div>";
    $("#status-area").innerHTML = html;
  }

  $("#reset-checks").addEventListener("click", function () {
    if (confirm("모든 점검 체크·해당없음 표시를 초기화할까요? (메모와 수감자료 목록은 유지됩니다)")) {
      checks = {}; naCases = {};
      save(LS_CHECKS, checks); save(LS_NA, naCases);
      renderCats(); renderCases(); renderStats();
    }
  });

  /* ───────── 인쇄 보고서 ───────── */
  $("#print-report").addEventListener("click", function () {
    var today = new Date();
    var dateStr = today.getFullYear() + ". " + (today.getMonth() + 1) + ". " + today.getDate() + ".";
    var cp = totalProgress();
    var checkPct = cp.total ? Math.round(cp.done / cp.total * 100) : 0;

    var html = "<h1>학교 종합감사 사전 자체점검 결과 보고</h1>" +
      '<p class="print-meta">' + esc(settings.school || "(학교명 미입력)") +
      (settings.auditDate ? " · 감사 예정일 " + esc(settings.auditDate) : "") +
      " · 점검일 " + dateStr + " · 기준: " + esc(DATA_META.region) + "</p>" +
      '<table class="sign-table"><tr><th>담당</th><th>교감</th><th>교장</th></tr>' +
      "<tr><td></td><td></td><td></td></tr></table>";

    // 요약
    html += "<h2>점검 요약 — 전체 " + cp.done + "/" + cp.total + "문항 (" + checkPct + "%)</h2>" +
      "<table><tr><th>분야</th><th>점검/전체</th><th>진행률</th><th>해당없음 처리 사례</th></tr>";
    CATEGORIES.forEach(function (cat) {
      var p = catProgress(cat.id);
      var naList = CASES.filter(function (c) { return c.cat === cat.id && naCases[c.id]; })
        .map(function (c) { return c.title; }).join(", ");
      html += "<tr><td>" + esc(cat.name) + "</td><td>" + p.done + "/" + p.total + "</td><td>" +
        (p.total ? Math.round(p.done / p.total * 100) : 100) + "%</td><td class=\"na\">" + esc(naList || "-") + "</td></tr>";
    });
    html += "</table>";

    // 분야별 상세
    CATEGORIES.forEach(function (cat) {
      var catCases = CASES.filter(function (c) { return c.cat === cat.id; });
      if (!catCases.length) return;
      html += "<h2>" + esc(cat.name) + "</h2>" +
        "<table><tr><th style=\"width:28%\">지적사례 유형</th><th>점검 문항</th><th style=\"width:8%\">결과</th></tr>";
      catCases.forEach(function (c) {
        var rowSpan = c.checks.length + (memos[c.id] ? 1 : 0);
        c.checks.forEach(function (q, i) {
          var cell;
          if (naCases[c.id]) cell = '<td class="na">해당없음</td>';
          else if (checks[checkKey(c.id, i)]) cell = '<td class="ok">점검</td>';
          else cell = '<td class="ng">미점검</td>';
          html += "<tr>" + (i === 0 ? '<td rowspan="' + rowSpan + '">' + esc(c.title) + "</td>" : "") +
            "<td>" + esc(q) + "</td>" + cell + "</tr>";
        });
        if (memos[c.id]) {
          html += '<tr><td colspan="2" class="print-memo">✎ ' + esc(memos[c.id]) + "</td></tr>";
        }
      });
      html += "</table>";
    });

    // 수감자료
    if (board.length) {
      var bp = boardProgress();
      html += "<h2>수감자료 준비 현황 (" + bp.done + "/" + bp.total + "건)</h2>" +
        "<table><tr><th>항목</th><th>담당부서</th><th>담당자</th><th>상태</th></tr>";
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
  renderDash();
})();
