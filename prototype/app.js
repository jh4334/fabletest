/* 감사내비 프로토타입 v2 — 서버·DB 없이 localStorage만 사용 */
(function () {
  "use strict";

  var LS_CHECKS   = "gamsanavi.checks.v1";    // { checkKey: true }
  var LS_BOARD    = "gamsanavi.board.v1";     // [{name, dept, owner, status}]
  var LS_NA       = "gamsanavi.na.v1";        // { caseId: true }  해당없음 처리
  var LS_MEMO     = "gamsanavi.memo.v1";      // { caseId: "메모" }
  var LS_SETTINGS = "gamsanavi.settings.v1";  // { school, auditDate }
  var LS_METRICS  = "gamsanavi.metrics.v1";   // 사용 효과 측정용
  var LS_ROLE     = "gamsanavi.role.v1";      // 담당 역할 필터

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  /* 학교 PC 보안 설정으로 저장소가 차단된 경우에도 앱이 멈추지 않도록 한다
     (저장만 안 되고 세션 내 사용은 가능 → 백업 파일 저장 안내) */
  var storageBlocked = false;
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) {
      if (!storageBlocked) {
        storageBlocked = true;
        var meta = $("#meta-line");
        if (meta) meta.textContent =
          "⚠ 이 브라우저 설정에서는 자동 저장이 되지 않습니다. 종료 전 [통계·보고서]의 백업 파일 저장을 이용하세요.";
      }
    }
  }

  var checks   = load(LS_CHECKS, {});
  var board    = load(LS_BOARD, []);
  var naCases  = load(LS_NA, {});
  var memos    = load(LS_MEMO, {});
  var settings = load(LS_SETTINGS, { school: "", auditDate: "" });
  var metrics  = load(LS_METRICS, {
    firstActAt: null,   // 최초 점검 시각(ISO)
    lastActAt: null,    // 마지막 활동 시각(ms)
    activeMs: 0,        // 누적 점검 시간(ms) — 활동 간격이 길면 휴지로 보고 제외
    startPct: null,     // 최초 점검 시점의 종합 준비도(%)
    snapshots: []       // [{ at: ISO, pct: 종합 준비도% }] 준비도 변화 추이
  });
  var activeCat = CATEGORIES[0].id;
  var searchTerm = "";
  var activeRole = "";
  try { activeRole = localStorage.getItem(LS_ROLE) || ""; } catch (e) { /* 차단 시 무시 */ }
  /* 복원된 역할에 맞춰 첫 활성 분야를 보이는 분야 중 하나로 맞춘다(아래 visibleCategories 사용) */

  /* ───────── 사용 효과 측정 (연구 효과성 검증용) ───────── */
  var ACTIVE_GAP_MS = 10 * 60 * 1000; // 10분 이상 비활동이면 다른 세션으로 보고 시간 미합산
  function recordActivity() {
    var now = Date.now();
    if (!metrics.firstActAt) {
      metrics.firstActAt = new Date(now).toISOString();
      metrics.startPct = overallPct();
    }
    if (metrics.lastActAt) {
      var gap = now - metrics.lastActAt;
      if (gap > 0 && gap < ACTIVE_GAP_MS) metrics.activeMs += gap;
    }
    metrics.lastActAt = now;
    snapshotReadiness(now);
    save(LS_METRICS, metrics);
  }
  /* 종합 준비도가 바뀔 때만 스냅샷을 남겨 추이 그래프를 만든다 */
  function snapshotReadiness(now) {
    var pct = overallPct();
    var last = metrics.snapshots[metrics.snapshots.length - 1];
    if (!last || last.pct !== pct) {
      metrics.snapshots.push({ at: new Date(now).toISOString(), pct: pct });
      if (metrics.snapshots.length > 500) metrics.snapshots.shift();
    }
  }
  function overallPct() {
    var cp = totalProgress(), bp = boardProgress();
    var checkPct = cp.total ? Math.round(cp.done / cp.total * 100) : 0;
    var boardPct = bp.total ? Math.round(bp.done / bp.total * 100) : null;
    return boardPct === null ? checkPct : Math.round((checkPct + boardPct) / 2);
  }
  function fmtDuration(ms) {
    var min = Math.round(ms / 60000);
    if (min < 60) return min + "분";
    return Math.floor(min / 60) + "시간 " + (min % 60) + "분";
  }
  function daysBetween(isoA, isoB) {
    var a = new Date(isoA), b = new Date(isoB);
    a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / 86400000) + 1; // 시작일 포함
  }

  /* ───────── 공통 유틸 ───────── */
  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  var CAT_MAP = {};
  CATEGORIES.forEach(function (c) { CAT_MAP[c.id] = c; });
  /* data.js 입력 실수(cat 오타)가 있어도 앱이 죽지 않고 원시 id를 표시 */
  function catById(id) { return CAT_MAP[id] || { id: id, name: id, desc: "" }; }
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
      var on = b.dataset.tab === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
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
  bindActivate($("#home-btn"), function () { switchTab("dash"); });

  function gotoCategory(catId) {
    activeCat = catId;
    searchTerm = "";
    $("#search").value = "";
    // 역할 필터가 켜져 있고 대상 분야가 그 역할에 없으면 전체 보기로 풀어 준다
    if (!visibleCategories().some(function (c) { return c.id === catId; })) {
      activeRole = "";
      try { localStorage.setItem(LS_ROLE, ""); } catch (e) { /* 무시 */ }
      var sel = $("#role-filter"); if (sel) sel.value = "";
    }
    renderCats(); renderCases(); switchTab("check");
  }

  /* 클릭과 키보드(Enter/Space) 모두에서 동작하도록 바인딩 */
  function bindActivate(el, fn) {
    el.addEventListener("click", fn);
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    });
  }

  /* ④ 담당 역할 → 점검 분야 매핑 (학교 업무분장 기준) */
  var ROLES = [
    { id: "gyomu",   name: "교무·교육과정 담당", cats: ["gyomu", "chehum"] },
    { id: "haengjeong", name: "행정실(회계·계약·시설)", cats: ["hoegye", "gyeyak", "sisul"] },
    { id: "boksu",   name: "인사·복무·보수 담당", cats: ["bokmu", "sudang"] },
    { id: "bangkwa", name: "방과후·돌봄 담당", cats: ["bangkwa"] },
    { id: "geupsik", name: "영양·급식 담당", cats: ["geupsik"] },
    { id: "jeongbo", name: "정보·개인정보 담당", cats: ["jeongbo"] },
    { id: "sahak",   name: "사립학교·법인 담당", cats: ["sahak"] }
  ];
  function roleById(id) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i].id === id) return ROLES[i];
    return null;
  }
  /* 현재 역할에 포함된 분야만 추린다(역할 미선택 시 전체) */
  function visibleCategories() {
    var r = roleById(activeRole);
    if (!r) return CATEGORIES;
    return CATEGORIES.filter(function (c) { return r.cats.indexOf(c.id) !== -1; });
  }

  /* ⑥ 감사 준비 일정 — 감사실무매뉴얼 기준 D-day 역산 작업 */
  var TIMELINE = [
    { off: 30, task: "분야별 자체점검 착수 — 빈출(★) 사례부터 확인", note: "준비 기간 확보" },
    { off: 10, task: "종합감사 수감자료 제출", note: "감사 개시 10일 전까지(자체감사 규칙 §20④)" },
    { off: 7,  task: "감사계획 통보 수령·검토 (감사대상·범위·기간)", note: "감사예정일 7일 전(시행령 §12)" },
    { off: 3,  task: "수감자료·비치서류 최종 점검, 담당별 준비 상태 확인", note: "" },
    { off: 1,  task: "감사장 설치·준비물 확인 (복사기·프린터·파쇄기·통장·사무용품)", note: "감사실무매뉴얼 감사당일 준비" },
    { off: 0,  task: "감사 개시 — 기관장 환담, 수감 시작", note: "" }
  ];
  function renderTimeline() {
    var el = $("#dash-timeline");
    if (!settings.auditDate) {
      el.innerHTML = '<li class="tl-empty">감사 예정일을 입력하면 매뉴얼 기준 준비 일정이 역산되어 표시됩니다.</li>';
      return;
    }
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var target = new Date(settings.auditDate + "T00:00:00");
    el.innerHTML = TIMELINE.map(function (t) {
      var d = new Date(target); d.setDate(d.getDate() - t.off);
      var dstr = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
      var ddiff = Math.round((d - today) / 86400000);
      var state, badge;
      if (ddiff < 0) { state = "past"; badge = "지남"; }
      else if (ddiff === 0) { state = "today"; badge = "오늘"; }
      else if (ddiff <= 7) { state = "soon"; badge = "D-" + ddiff; }
      else { state = "future"; badge = "D-" + ddiff; }
      return '<li class="tl-item tl-' + state + '">' +
        '<span class="tl-date">' + dstr + '</span>' +
        '<span class="tl-badge">' + badge + "</span>" +
        '<span class="tl-task">' + esc(t.task) +
        (t.note ? ' <span class="tl-note">' + esc(t.note) + "</span>" : "") + "</span></li>";
    }).join("");
  }

  /* ───────── 탭0: 대시보드 ───────── */
  function renderDash() {
    renderTimeline();
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
      // 종합감사 수감자료는 감사 개시 10일 전까지 제출 (충북교육청 자체감사 규칙 제20조제4항)
      var sub = new Date(target); sub.setDate(sub.getDate() - 10);
      var sdiff = Math.round((sub - today) / 86400000);
      var subStr = sub.getFullYear() + "-" + ("0" + (sub.getMonth() + 1)).slice(-2) +
        "-" + ("0" + sub.getDate()).slice(-2);
      $("#dday-mile").innerHTML = "📌 수감자료 제출 마감 <b>" + subStr + "</b> " +
        (sdiff > 0 ? "(D-" + sdiff + ")" : (sdiff === 0 ? "(오늘!)" : "(마감 지남)")) +
        ' <span class="muted">— 감사 개시 10일 전까지 제출(충북교육청 자체감사 규칙 제20조)</span>';
    } else {
      dEl.textContent = "D-?";
      dEl.className = "dday-big unset";
      dateEl.textContent = "학교명과 감사 예정일을 입력하세요";
      $("#dday-mile").innerHTML = "";
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
      return '<div class="dash-cat-row" role="button" tabindex="0" data-goto="' + r.cat.id + '">' +
        '<span class="dc-name">' + esc(r.cat.name) + "</span>" +
        '<span class="dc-bar">' + progressBarHTML(r.pct) + "</span>" +
        '<span class="dc-num">' + r.p.done + "/" + r.p.total + "</span></div>";
    }).join("");
    document.querySelectorAll("#dash-cats [data-goto]").forEach(function (el) {
      bindActivate(el, function () { gotoCategory(el.dataset.goto); });
    });

    // 추천 점검: 빈출(freq>=3) 사례 중 미완료·해당없음 아닌 것
    var todos = CASES.filter(function (c) {
      return (c.freq || 0) >= 3 && !naCases[c.id] && !caseDone(c);
    }).slice(0, 6);
    $("#dash-todo").innerHTML = todos.length
      ? todos.map(function (c) {
          return '<li role="button" tabindex="0" data-goto="' + c.cat + '">★ ' + esc(c.title) +
            '<span class="todo-cat">' + esc(catById(c.cat).name) + "</span></li>";
        }).join("")
      : '<li class="all-done">✔ 빈출 사례 점검을 모두 마쳤습니다. 분야별 점검을 이어가세요.</li>';
    document.querySelectorAll("#dash-todo li[data-goto]").forEach(function (el) {
      bindActivate(el, function () { gotoCategory(el.dataset.goto); });
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
    visibleCategories().forEach(function (cat) {
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

  /* ④ 역할 선택 드롭다운 구성 + 동작 */
  (function initRoleFilter() {
    var sel = $("#role-filter");
    ROLES.forEach(function (r) {
      var o = document.createElement("option");
      o.value = r.id; o.textContent = r.name;
      sel.appendChild(o);
    });
    sel.value = activeRole;
    // 복원된 역할에 첫 활성 분야가 없으면 보이는 첫 분야로 맞춘다
    var vis0 = visibleCategories();
    if (!vis0.some(function (c) { return c.id === activeCat; }) && vis0.length) activeCat = vis0[0].id;
    sel.addEventListener("change", function () {
      activeRole = sel.value;
      try { localStorage.setItem(LS_ROLE, activeRole); } catch (e) { /* 무시 */ }
      // 선택한 역할에 현재 분야가 없으면 역할의 첫 분야로 이동
      var vis = visibleCategories();
      if (!vis.some(function (c) { return c.id === activeCat; })) {
        activeCat = vis.length ? vis[0].id : CATEGORIES[0].id;
      }
      searchTerm = ""; $("#search").value = "";
      renderCats(); renderCases();
    });
  })();

  function matchesSearch(c, term) {
    var hay = (c.title + " " + c.detail + " " + c.basis + " " + c.checks.join(" ") + " " +
      (c.examples || []).join(" ")).toLowerCase();
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
    // 분야 전체가 우리 학교와 무관할 때(예: 공립학교의 사학분야) 한 번에 제외
    if (!searchTerm) {
      var allNA = list.every(function (c) { return naCases[c.id]; });
      html += '<div class="cat-na-bar no-print"><button type="button" class="link-btn" id="cat-na-all">' +
        (allNA ? "↩ 이 분야 전체를 점검 대상으로 되돌리기" : "이 분야 전체 해당없음(우리 학교 무관)") +
        "</button></div>";
    }
    list.forEach(function (c) {
      var isNA = !!naCases[c.id];
      var memo = memos[c.id] || "";
      html += '<div class="case-card' + (isNA ? " is-na" : "") + '" id="card-' + c.id + '">' +
        '<div class="case-head"><div><h3>' + esc(c.title) + "</h3>" +
        (c.verified === false ? '<span class="unverified">⚠ 원문 확인 전(예시)</span>' : "") +
        "</div><div class=\"head-chips\">" +
        ((c.freq || 0) >= 3 ? '<span class="chip freq">★ 빈출' + (c.freq > 3 ? " ×" + c.freq : "") + "</span>" : "") +
        (c.disposition ? '<span class="chip">' + esc(c.disposition) + "</span>" : "") + "</div></div>" +
        (searchTerm ? '<div class="case-docs" style="margin:2px 0 6px">분야: ' + esc(catById(c.cat).name) + "</div>" : "") +
        '<p class="case-detail">' + esc(c.detail) + "</p>" +
        (c.examples && c.examples.length ?
          '<details class="case-ex"><summary>실제 지적사례 ' + c.examples.length + "건 보기</summary><ul>" +
          c.examples.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") +
          "</ul></details>" : "") +
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
        '<button type="button" class="link-btn na-toggle" data-na="' + c.id + '">' + (isNA ? "↩ 점검 대상으로 되돌리기" : "해당없음(우리 학교 무관)") + "</button>" +
        '<button type="button" class="link-btn memo-toggle' + (memo ? " has-memo" : "") + '" data-memo="' + c.id + '">✎ 메모' + (memo ? " 있음" : "") + "</button>" +
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
        recordActivity();
        box.parentElement.classList.toggle("done", box.checked);
        renderCats();
      });
    });
    var naAllBtn = document.getElementById("cat-na-all");
    if (naAllBtn) {
      naAllBtn.addEventListener("click", function () {
        var allNA = list.every(function (c) { return naCases[c.id]; });
        if (!allNA && !confirm("이 분야의 사례 " + list.length + "건을 모두 '해당없음'으로 표시할까요?")) return;
        list.forEach(function (c) {
          if (allNA) delete naCases[c.id];
          else naCases[c.id] = true;
        });
        save(LS_NA, naCases);
        recordActivity();
        renderCats(); renderCases();
      });
    }
    document.querySelectorAll("#case-area .na-toggle").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = el.dataset.na;
        if (naCases[id]) delete naCases[id];
        else naCases[id] = true;
        save(LS_NA, naCases);
        recordActivity();
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
        save(LS_BOARD, board); recordActivity(); renderBoard();
      });
    });
    document.querySelectorAll("#board-body .del-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        board.splice(+btn.dataset.del, 1);
        save(LS_BOARD, board); renderBoard();
      });
    });
  }

  /* 엑셀 머리글 행("항목명/담당부서…")이 같이 복사된 경우 건너뛴다 */
  function isHeaderRow(cols) {
    return /^(연번|번호|순번|항목명?|수감자료\s*(항목|목록)?명?|자료명)$/.test((cols[0] || "").trim());
  }

  $("#import-btn").addEventListener("click", function () {
    var lines = $("#paste-input").value.split(/\r?\n/);
    var added = 0;
    lines.forEach(function (line) {
      if (!line.trim()) return;
      var cols = line.split("\t");
      if (isHeaderRow(cols)) return;
      var name = (cols[0] || "").trim();
      if (!name) return; // 첫 칸이 빈 행(엑셀 빈 셀)은 건너뜀
      board.push({
        name: name,
        dept: (cols[1] || "").trim(),
        owner: (cols[2] || "").trim(),
        status: "미시작"
      });
      added++;
    });
    if (!added) {
      alert("가져올 항목을 찾지 못했습니다.\n항목명이 첫 번째 열에 오도록 붙여넣어 주세요.");
      return;
    }
    save(LS_BOARD, board);
    $("#paste-input").value = "";
    $("#paste-box").removeAttribute("open");
    renderBoard();
  });

  /* 충북교육청 감사실무매뉴얼(2025 개정)의 종합감사 공통 준비·징구 서류 */
  var OFFICIAL_ITEMS = [
    ["종합감사 수감자료 (감사 개시 10일 전까지 제출)", "행정실"],
    ["주요업무계획(학교교육계획) 책자", "교무부"],
    ["금고검사조서 (예금·현금 현재 조서, 예금 잔액증명서, 기관 계좌 수신정보조회표)", "행정실"],
    ["공무원행동강령 이행 점검표", "교무부"],
    ["운동부 청렴도 제고 자체 점검표 (운동부 운영교만)", "체육부"],
    ["우수사례 (인쇄물 및 한글 파일, 수감자료 제출 시)", ""],
    ["제도개선 및 건의사항 (수감자료 제출 시)", ""],
    ["감사장 준비: 복사기·프린터·파쇄기·사무분장표·직원배치도·비치서류·기관 통장·사무용품", "행정실"]
  ];
  $("#official-btn").addEventListener("click", function () {
    var existing = {};
    board.forEach(function (i) { existing[i.name] = true; });
    var added = 0;
    OFFICIAL_ITEMS.forEach(function (it) {
      if (existing[it[0]]) return;
      board.push({ name: it[0], dept: it[1], owner: "", status: "미시작" });
      added++;
    });
    save(LS_BOARD, board);
    renderBoard();
    alert(added ? "감사실무매뉴얼 기준 기본 준비물 " + added + "건을 추가했습니다.\n학교 상황에 맞게 담당자를 지정하고, 해당 없는 항목은 '해당없음'으로 바꾸세요."
      : "기본 준비물이 이미 모두 등록되어 있습니다.");
  });

  $("#template-btn").addEventListener("click", function () {
    downloadCSV("수감자료목록_양식.csv", [
      ["수감자료 항목", "담당부서", "담당자"],
      ["최근 3년 학교회계 세입세출 결산서", "행정실", "김○○"],
      ["학업성적관리위원회 회의록", "교무부", "이○○"],
      ["수의계약 체결 현황(최근 3년)", "행정실", "박○○"]
    ]);
    alert("양식 파일(수감자료목록_양식.csv)이 내려받기 되었습니다.\n" +
      "엑셀에서 열어 작성한 뒤, 데이터 영역을 복사해 이 붙여넣기 칸에 붙여넣으세요.");
  });

  $("#sample-btn").addEventListener("click", function () {
    $("#paste-input").value =
      "최근 3년 학교회계 세입세출 결산서\t행정실\t김○○\n" +
      "학업성적관리위원회 회의록\t교무부\t이○○\n" +
      "수의계약 체결 현황(최근 3년)\t행정실\t박○○";
    $("#paste-box").setAttribute("open", "");
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
    document.body.appendChild(a); // 일부 브라우저는 DOM 밖 앵커의 download 속성을 무시함
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function downloadCSV(filename, rows) {
    var csv = "\uFEFF" + rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c);
        // \uC5D1\uC140 \uC218\uC2DD \uC8FC\uC785 \uBC29\uC9C0: =, +, -, @\uB85C \uC2DC\uC791\uD558\uB294 \uC140\uC740 \uBB38\uC790\uB85C \uAC15\uC81C
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(",");
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
      app: "gamsanavi", version: 3, exportedAt: new Date().toISOString(),
      settings: settings, checks: checks, board: board, na: naCases, memos: memos,
      metrics: metrics
    };
    var name = "감사내비_백업_" + new Date().toISOString().slice(0, 10) + ".json";
    downloadFile(name, JSON.stringify(payload, null, 2), "application/json");
  });

  /* 외부 파일(백업 JSON)은 손상·수정 가능성이 있으므로 형태를 강제한다 */
  function sanitizeObject(obj) {
    return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
  }
  function sanitizeBoard(arr) {
    return (Array.isArray(arr) ? arr : []).map(function (i) {
      i = (i && typeof i === "object") ? i : {};
      return {
        name: String(i.name || ""),
        dept: String(i.dept || ""),
        owner: String(i.owner || ""),
        status: STATUSES.indexOf(i.status) !== -1 ? i.status : "미시작"
      };
    }).filter(function (i) { return i.name; });
  }
  function sanitizeSettings(s) {
    s = (s && typeof s === "object") ? s : {};
    return {
      school: String(s.school || ""),
      auditDate: /^\d{4}-\d{2}-\d{2}$/.test(s.auditDate || "") ? s.auditDate : ""
    };
  }
  function sanitizeMetrics(m) {
    var def = { firstActAt: null, lastActAt: null, activeMs: 0, startPct: null, snapshots: [] };
    if (!m || typeof m !== "object") return def;
    var snaps = Array.isArray(m.snapshots) ? m.snapshots.filter(function (s) {
      return s && typeof s.at === "string" && typeof s.pct === "number";
    }).map(function (s) { return { at: s.at, pct: s.pct }; }) : [];
    return {
      firstActAt: typeof m.firstActAt === "string" ? m.firstActAt : null,
      lastActAt: typeof m.lastActAt === "number" ? m.lastActAt : null,
      activeMs: typeof m.activeMs === "number" && m.activeMs >= 0 ? m.activeMs : 0,
      startPct: typeof m.startPct === "number" ? m.startPct : null,
      snapshots: snaps
    };
  }

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
      checks   = sanitizeObject(payload.checks);
      board    = sanitizeBoard(payload.board);
      naCases  = sanitizeObject(payload.na);
      memos    = sanitizeObject(payload.memos);
      settings = sanitizeSettings(payload.settings);
      metrics  = sanitizeMetrics(payload.metrics);
      save(LS_CHECKS, checks); save(LS_BOARD, board); save(LS_NA, naCases);
      save(LS_MEMO, memos); save(LS_SETTINGS, settings); save(LS_METRICS, metrics);
      renderCats(); renderCases(); renderBoard(); renderDash(); renderStats();
      alert("복원이 완료되었습니다.");
    };
    reader.readAsText(file, "utf-8");
  });

  /* ───────── 탭3: 통계·보고서 ───────── */
  /* data.js의 사례에 dispoGroup 필드가 있으면 그것을 쓰고,
     없으면 처분 문구의 키워드로 분류한다(실데이터 입력 시 dispoGroup 권장) */
  function dispositionGroup(c) {
    if (c.dispoGroup) return c.dispoGroup;
    var d = c.disposition || "";
    if (d.indexOf("회수") !== -1 || d.indexOf("시정") !== -1) return "시정·회수(금전)";
    if (d.indexOf("경고") !== -1) return "경고";
    return "주의 등";
  }

  function barRowHTML(name, n, max, unit) {
    return '<div class="bar-row"><span class="bar-name">' + esc(name) + "</span>" +
      '<span class="bar-track"><span class="bar-fill" style="display:block;width:' +
      Math.round(n / (max || 1) * 100) + '%"></span></span>' +
      '<span class="bar-num">' + n + (unit || "건") + "</span></div>";
  }

  /* ① 분야×유형 지적사례 빈도 집계 (연구 근거자료) */
  function freqByCategory() {
    return CATEGORIES.map(function (cat) {
      var topics = CASES.filter(function (c) { return c.cat === cat.id && (c.freq || 0) > 0; })
        .map(function (c) { return { title: c.title, freq: c.freq || 0 }; })
        .sort(function (a, b) { return b.freq - a.freq; });
      var total = topics.reduce(function (s, t) { return s + t.freq; }, 0);
      return { name: cat.name, topics: topics, total: total };
    }).filter(function (r) { return r.total > 0; })
      .sort(function (a, b) { return b.total - a.total; });
  }
  function freqGrandTotal() {
    return CASES.reduce(function (s, c) { return s + (c.freq || 0); }, 0);
  }

  /* ② 사용 효과 측정 요약 */
  function effectSummary() {
    var now = overallPct();
    var hasData = !!metrics.firstActAt;
    var days = hasData ? daysBetween(metrics.firstActAt, new Date().toISOString()) : 0;
    return {
      hasData: hasData,
      firstActAt: metrics.firstActAt,
      days: days,
      activeMin: Math.round(metrics.activeMs / 60000),
      activeStr: fmtDuration(metrics.activeMs),
      startPct: metrics.startPct == null ? 0 : metrics.startPct,
      nowPct: now,
      snapshots: metrics.snapshots
    };
  }
  /* 준비도 추이 스파크라인(SVG) — 외부 라이브러리 없이 인라인 생성 */
  function sparklineSVG(snaps, w, h) {
    if (!snaps || snaps.length < 2) return "";
    var t0 = new Date(snaps[0].at).getTime();
    var t1 = new Date(snaps[snaps.length - 1].at).getTime();
    var span = (t1 - t0) || 1;
    var pad = 4;
    var pts = snaps.map(function (s) {
      var x = pad + (new Date(s.at).getTime() - t0) / span * (w - 2 * pad);
      var y = h - pad - (s.pct / 100) * (h - 2 * pad);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    return '<svg class="sparkline" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
      '" preserveAspectRatio="none" role="img" aria-label="준비도 추이">' +
      '<polyline fill="none" stroke="#1f6f3f" stroke-width="2" points="' + pts.join(" ") + '"/>' +
      '<circle cx="' + pts[pts.length - 1].split(",")[0] + '" cy="' + pts[pts.length - 1].split(",")[1] +
      '" r="3" fill="#1f6f3f"/></svg>';
  }
  function effectCardHTML() {
    var e = effectSummary();
    var html = '<div class="status-card effect-card"><h4>사용 효과 측정 <span class="muted">— 연구 효과성 검증용</span></h4>';
    if (!e.hasData) {
      html += '<p class="empty">아직 점검 기록이 없습니다. [분야별 자체점검]에서 점검을 시작하면 ' +
        '점검 시작일·누적 점검 시간·준비도 변화가 자동으로 측정됩니다.</p></div>';
      return html;
    }
    var gain = e.nowPct - e.startPct;
    html += '<div class="effect-nums">' +
      '<div class="effect-stat"><span class="es-num">' + e.days + '</span><span class="es-lbl">점검 진행 일수</span></div>' +
      '<div class="effect-stat"><span class="es-num">' + e.activeStr + '</span><span class="es-lbl">누적 점검 시간</span></div>' +
      '<div class="effect-stat"><span class="es-num">' + e.startPct + '<small>%</small> → ' + e.nowPct + '<small>%</small></span>' +
      '<span class="es-lbl">준비도 변화 ' + (gain >= 0 ? "▲" + gain : "▼" + (-gain)) + 'p</span></div>' +
      "</div>";
    var spark = sparklineSVG(e.snapshots, 320, 56);
    if (spark) html += '<div class="spark-wrap">' + spark + '<div class="spark-axis"><span>점검 시작</span><span>현재</span></div></div>';
    html += '<button type="button" class="link-btn" id="metrics-reset">측정 기록 초기화</button>';
    html += "</div>";
    return html;
  }

  function renderStats() {
    var html = '<div class="status-grid">';

    // ② 사용 효과 측정 (가장 위 — 연구 효과성 지표)
    html += effectCardHTML();

    // 분야별 사례 분포 (데이터 분석 관점)
    var counts = CATEGORIES.map(function (cat) {
      return { name: cat.name, n: CASES.filter(function (c) { return c.cat === cat.id; }).length };
    }).sort(function (a, b) { return b.n - a.n; });
    var maxN = counts[0] ? counts[0].n : 1;
    html += '<div class="status-card"><h4>분야별 지적사례 분포 (수록 ' + CASES.length + "건)</h4>";
    counts.forEach(function (r) { html += barRowHTML(r.name, r.n, maxN); });
    html += "</div>";

    // 처분 유형 분포 — 사례에 처분 정보가 없으면(2025 사례집은 처분 결과를 생략) 지적 빈도 분포로 대체
    var hasDispo = CASES.some(function (c) { return c.disposition; });
    if (hasDispo) {
      var groups = {};
      CASES.forEach(function (c) {
        var g = dispositionGroup(c);
        groups[g] = (groups[g] || 0) + 1;
      });
      var gRows = Object.keys(groups).map(function (g) { return { name: g, n: groups[g] }; })
        .sort(function (a, b) { return b.n - a.n; });
      var gMax = gRows[0] ? gRows[0].n : 1;
      html += '<div class="status-card"><h4>처분 유형 분포 — 금전 처분(회수)이 걸린 분야가 우선 점검 대상</h4>';
      gRows.forEach(function (r) { html += barRowHTML(r.name, r.n, gMax); });
      html += "</div>";
    } else {
      var fRows = CATEGORIES.map(function (cat) {
        var n = CASES.filter(function (c) { return c.cat === cat.id; })
          .reduce(function (s, c) { return s + (c.freq || 0); }, 0);
        return { name: cat.name, n: n };
      }).filter(function (r) { return r.n > 0; })
        .sort(function (a, b) { return b.n - a.n; });
      var fMax = fRows[0] ? fRows[0].n : 1;
      html += '<div class="status-card"><h4>분야별 지적 빈도 — 사례집 수록 지적사례 건수 기준, 빈도 높은 분야가 우선 점검 대상</h4>';
      fRows.forEach(function (r) { html += barRowHTML(r.name, r.n, fMax); });
      html += "</div>";
    }

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
    html += "</div>";

    // ① 분야×유형 지적 빈도 집계표 (연구 근거자료 — 펼치기)
    var fc = freqByCategory();
    if (fc.length) {
      html += '<div class="status-card status-wide"><h4>지적사례 빈도 집계표 ' +
        '<span class="muted">— 2025년 자체감사 사례집 수록 기준 (총 ' + freqGrandTotal() + '건)</span></h4>' +
        '<details class="freq-detail"><summary>분야·유형별 빈도 펼쳐 보기</summary>' +
        '<table class="freq-table"><thead><tr><th>분야</th><th>지적 유형</th><th class="num">건수</th></tr></thead><tbody>';
      fc.forEach(function (r) {
        r.topics.forEach(function (t, i) {
          html += "<tr>" +
            (i === 0 ? '<td rowspan="' + r.topics.length + '" class="fc-cat">' + esc(r.name) +
              '<span class="fc-total">소계 ' + r.total + "</span></td>" : "") +
            "<td>" + esc(t.title) + (t.freq >= 3 ? ' <span class="freq-star">★</span>' : "") +
            '</td><td class="num">' + t.freq + "</td></tr>";
        });
      });
      html += '<tr class="freq-grand"><td colspan="2">합계</td><td class="num">' + freqGrandTotal() + "</td></tr>";
      html += "</tbody></table></details></div>";
    }

    html += "</div>";
    $("#status-area").innerHTML = html;

    var mr = document.getElementById("metrics-reset");
    if (mr) mr.addEventListener("click", function () {
      if (!confirm("사용 효과 측정 기록(점검 시간·준비도 추이)을 초기화할까요?\n점검 체크 내용은 그대로 유지됩니다.")) return;
      metrics = { firstActAt: null, lastActAt: null, activeMs: 0, startPct: null, snapshots: [] };
      save(LS_METRICS, metrics);
      renderStats();
    });
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

    // 사용 효과 요약 (연구 효과성 근거) — 측정 기록이 있을 때만
    var e = effectSummary();
    if (e.hasData) {
      var gain = e.nowPct - e.startPct;
      html += '<p class="print-effect">▶ 사전 점검 효과: 점검 시작 ' +
        new Date(e.firstActAt).toLocaleDateString("ko-KR") + " 이후 " + e.days + "일간, 누적 점검 시간 " +
        e.activeStr + ", 종합 준비도 " + e.startPct + "% → " + e.nowPct + "%(" +
        (gain >= 0 ? "+" + gain : gain) + "p)</p>";
    }

    // 요약
    html += "<h2>점검 요약 — 전체 " + cp.done + "/" + cp.total + "문항 (" + checkPct + "%)</h2>" +
      "<table><thead><tr><th>분야</th><th>점검/전체</th><th>진행률</th><th>해당없음 처리 사례</th></tr></thead><tbody>";
    CATEGORIES.forEach(function (cat) {
      var p = catProgress(cat.id);
      var naList = CASES.filter(function (c) { return c.cat === cat.id && naCases[c.id]; })
        .map(function (c) { return c.title; }).join(", ");
      html += "<tr><td>" + esc(cat.name) + "</td><td>" + p.done + "/" + p.total + "</td><td>" +
        (p.total ? Math.round(p.done / p.total * 100) + "%" : "–") + "</td><td class=\"na\">" + esc(naList || "-") + "</td></tr>";
    });
    html += "</tbody></table>";

    // 분야별 상세
    CATEGORIES.forEach(function (cat) {
      var catCases = CASES.filter(function (c) { return c.cat === cat.id; });
      if (!catCases.length) return;
      html += "<h2>" + esc(cat.name) + "</h2>" +
        "<table><thead><tr><th style=\"width:28%\">지적사례 유형</th><th>점검 문항</th><th style=\"width:8%\">결과</th></tr></thead><tbody>";
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
      html += "</tbody></table>";
    });

    // 수감자료
    if (board.length) {
      var bp = boardProgress();
      html += "<h2>수감자료 준비 현황 (" + bp.done + "/" + bp.total + "건)</h2>" +
        "<table><thead><tr><th>항목</th><th>담당부서</th><th>담당자</th><th>상태</th></tr></thead><tbody>";
      board.forEach(function (i) {
        html += "<tr><td>" + esc(i.name) + "</td><td>" + esc(i.dept) + "</td><td>" + esc(i.owner) + "</td><td>" + esc(i.status) + "</td></tr>";
      });
      html += "</tbody></table>";
    }

    // 지적사례 빈도 집계표 (연구 근거자료)
    var fc = freqByCategory();
    if (fc.length) {
      html += "<h2>[붙임] 지적사례 빈도 집계표 — 2025년 자체감사 사례집 수록 기준 (총 " + freqGrandTotal() + "건)</h2>" +
        '<table class="print-freq"><thead><tr><th style="width:22%">분야</th><th>지적 유형</th><th style="width:10%">건수</th></tr></thead><tbody>';
      fc.forEach(function (r) {
        r.topics.forEach(function (t, i) {
          html += "<tr>" +
            (i === 0 ? '<td rowspan="' + r.topics.length + '">' + esc(r.name) + " (소계 " + r.total + ")</td>" : "") +
            "<td>" + esc(t.title) + (t.freq >= 3 ? " ★" : "") + '</td><td class="num">' + t.freq + "</td></tr>";
        });
      });
      html += '<tr class="freq-grand"><td colspan="2">합계</td><td class="num">' + freqGrandTotal() + "</td></tr>";
      html += "</tbody></table>";
    }

    $("#print-area").innerHTML = html;
    window.print();
  });

  /* ⑤ 인수인계 보고서 — 후임자가 이어받을 수 있도록 메모·해당없음 사유·담당 배분·다음 할 일 정리 */
  $("#handover-report").addEventListener("click", function () {
    var today = new Date();
    var dateStr = today.getFullYear() + ". " + (today.getMonth() + 1) + ". " + today.getDate() + ".";
    var cp = totalProgress();
    var checkPct = cp.total ? Math.round(cp.done / cp.total * 100) : 0;

    var html = "<h1>종합감사 준비 인수인계 보고서</h1>" +
      '<p class="print-meta">' + esc(settings.school || "(학교명 미입력)") +
      (settings.auditDate ? " · 감사 예정일 " + esc(settings.auditDate) : "") +
      " · 작성일 " + dateStr + " · 종합 준비도 " + checkPct + "%</p>" +
      '<table class="sign-table"><tr><th>인계자</th><th>인수자</th><th>확인(교감)</th></tr>' +
      "<tr><td></td><td></td><td></td></tr></table>";

    // 1) 분야별 진행 요약
    html += "<h2>1. 분야별 진행 상황</h2>" +
      "<table><thead><tr><th>분야</th><th>점검/전체</th><th>진행률</th></tr></thead><tbody>";
    CATEGORIES.forEach(function (cat) {
      var p = catProgress(cat.id);
      html += "<tr><td>" + esc(cat.name) + "</td><td>" + p.done + "/" + p.total + "</td><td>" +
        (p.total ? Math.round(p.done / p.total * 100) + "%" : "–") + "</td></tr>";
    });
    html += "</tbody></table>";

    // 2) 인계 메모 (담당자가 남긴 메모) — 인수인계의 핵심
    var memoCases = CASES.filter(function (c) { return memos[c.id]; });
    html += "<h2>2. 인계 메모 (" + memoCases.length + "건) — 확인한 문서·후임자에게 남길 말</h2>";
    if (memoCases.length) {
      html += "<table><thead><tr><th style=\"width:24%\">분야</th><th style=\"width:30%\">사례</th><th>메모</th></tr></thead><tbody>";
      memoCases.forEach(function (c) {
        html += "<tr><td>" + esc(catById(c.cat).name) + "</td><td>" + esc(c.title) +
          '</td><td class="print-memo">' + esc(memos[c.id]) + "</td></tr>";
      });
      html += "</tbody></table>";
    } else {
      html += '<p class="hd-none">남긴 메모가 없습니다. 각 사례의 ✎ 메모에 확인 결과를 기록하면 이 자리에 정리됩니다.</p>';
    }

    // 3) 해당없음 처리 사례 + 사유
    var naList = CASES.filter(function (c) { return naCases[c.id]; });
    html += "<h2>3. 해당없음 처리 사례 (" + naList.length + "건) — 우리 학교 무관 사유 확인 필요</h2>";
    if (naList.length) {
      html += "<table><thead><tr><th style=\"width:24%\">분야</th><th>사례</th></tr></thead><tbody>";
      naList.forEach(function (c) {
        html += "<tr><td>" + esc(catById(c.cat).name) + "</td><td>" + esc(c.title) + "</td></tr>";
      });
      html += "</tbody></table>";
    } else {
      html += '<p class="hd-none">해당없음으로 처리한 사례가 없습니다.</p>';
    }

    // 4) 수감자료 담당 배분
    html += "<h2>4. 수감자료 담당 배분 현황</h2>";
    if (board.length) {
      html += "<table><thead><tr><th>항목</th><th>담당부서</th><th>담당자</th><th>상태</th></tr></thead><tbody>";
      board.forEach(function (i) {
        html += "<tr><td>" + esc(i.name) + "</td><td>" + esc(i.dept) + "</td><td>" + esc(i.owner) + "</td><td>" + esc(i.status) + "</td></tr>";
      });
      html += "</tbody></table>";
    } else {
      html += '<p class="hd-none">등록된 수감자료 목록이 없습니다.</p>';
    }

    // 5) 후임자가 이어서 할 일 — 빈출(★) 미점검
    var next = CASES.filter(function (c) { return (c.freq || 0) >= 3 && !naCases[c.id] && !caseDone(c); });
    html += "<h2>5. 이어서 할 일 — 빈출(★) 사례 중 미완료 (" + next.length + "건)</h2>";
    if (next.length) {
      html += "<table><thead><tr><th style=\"width:24%\">분야</th><th>사례</th></tr></thead><tbody>";
      next.forEach(function (c) {
        html += "<tr><td>" + esc(catById(c.cat).name) + "</td><td>" + esc(c.title) + "</td></tr>";
      });
      html += "</tbody></table>";
    } else {
      html += '<p class="hd-none">빈출 사례 점검을 모두 마쳤습니다.</p>';
    }

    $("#print-area").innerHTML = html;
    window.print();
  });

  /* ───────── 예시 데이터 안내 배너 ───────── */
  var LS_BANNER = "gamsanavi.bannerClosed.v1";
  try {
    if (localStorage.getItem(LS_BANNER)) $("#seed-banner").style.display = "none";
  } catch (e) { /* 저장소 차단 시 배너 유지 */ }
  $("#banner-close").addEventListener("click", function () {
    $("#seed-banner").style.display = "none";
    try { localStorage.setItem(LS_BANNER, "1"); } catch (e) { /* 무시 */ }
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
