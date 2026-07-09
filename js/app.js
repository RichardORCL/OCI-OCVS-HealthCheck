/* OCVS Health Check - app logic: data loading, hash router, rendering,
   persistence and the password-protected editor mode. */

(function () {
  "use strict";

  var STORAGE_KEY = "ocvs-healthcheck-v1";             // statuses + comments
  var LEGACY_DATA_KEY = "ocvs-healthcheck-data-v1";    // pre-server local checklist edits
  var EDITOR_KEY_SESSION = "ocvs-editor-key";          // editor password for this session
  var DATA_URL = "data/healthcheck.json";
  var SAVE_URL = "api/checklist";
  var FEEDBACK_URL = "api/feedback";
  var VERIFY_URL = "api/editor/verify";
  var DEFAULT_TITLE = "OCVS Health Check";
  var DEFAULT_DESCRIPTION =
    "Walk through the health check for Oracle Cloud VMware Solution. " +
    "Choose a category below or from the top bar, set a status for each item, " +
    "and record your findings in the comments. Your progress is saved automatically in this browser." +
    "<br><br><strong>Data privacy.</strong> No health check results are sent to or stored on the server. " +
    "Statuses and comments stay on your device in this browser only. To continue on another machine, " +
    "use <strong>Export results</strong> and <strong>Import results</strong> from the menu. " +
    "The only information sent to the server is optional feedback on checklist items, " +
    "which maintainers use to improve the health check.";

  var HEALTHCHECK = null;        // loaded checklist definition
  var editorPassword = sessionStorage.getItem(EDITOR_KEY_SESSION) || "";
  var editorEnabled = editorPassword !== "";
  var pendingEditId = null;      // item to open in inline edit after a re-render
  var feedbackData = null;       // all feedback per item id (editor mode only)

  // Inline SVG icons for the four statuses; they inherit color via currentColor.
  var ICONS = {
    none:
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2.8" stroke-linecap="round"/>' +
      "</svg>",
    done:
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="7" fill="currentColor"/>' +
      '<path d="M4.7 8.3l2.2 2.2 4.4-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>",
    wip:
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M8 4.9V8l2.3 1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>",
    attn:
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<path d="M8 1.6a1.2 1.2 0 0 1 1.05.62l6 10.8A1.2 1.2 0 0 1 14 14.8H2a1.2 1.2 0 0 1-1.05-1.78l6-10.8A1.2 1.2 0 0 1 8 1.6z" fill="currentColor"/>' +
      '<path d="M8 6v3.3" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>' +
      '<circle cx="8" cy="12" r="1" fill="#fff"/>' +
      "</svg>"
  };

  var DRAG_ICON =
    '<svg viewBox="0 0 10 16" aria-hidden="true">' +
    '<circle cx="3" cy="3" r="1.3" fill="currentColor"/><circle cx="7" cy="3" r="1.3" fill="currentColor"/>' +
    '<circle cx="3" cy="8" r="1.3" fill="currentColor"/><circle cx="7" cy="8" r="1.3" fill="currentColor"/>' +
    '<circle cx="3" cy="13" r="1.3" fill="currentColor"/><circle cx="7" cy="13" r="1.3" fill="currentColor"/>' +
    "</svg>";

  var EDIT_ICONS = {
    edit:
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<path d="M10.8 2.6l2.6 2.6-8 8-3.2.6.6-3.2 8-8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      "</svg>",
    add:
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      "</svg>",
    remove:
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<path d="M3 4h10M6.5 4V2.7a.7.7 0 0 1 .7-.7h1.6a.7.7 0 0 1 .7.7V4M4.3 4l.6 9.4a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9L11.7 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>"
  };

  var FEEDBACK_ICON =
    '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H8.2L5 13.8V11H4a1.5 1.5 0 0 1-1.5-1.5v-6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<path d="M5.2 5.6h5.6M5.2 7.9h3.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
    "</svg>";

  var COPY_ICON =
    '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M4.5 10.5h-1.5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1.5" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    "</svg>";

  var STATUSES = [
    { id: "none", label: "Not checked", cls: "s-none", icon: ICONS.none },
    { id: "done", label: "Checked off", cls: "s-done", icon: ICONS.done },
    { id: "wip", label: "In progress", cls: "s-wip", icon: ICONS.wip },
    { id: "attn", label: "Needs attention", cls: "s-attn", icon: ICONS.attn }
  ];

  /* ----------------------- User text validation ----------------------- */

  var MAX_USER_TEXT_LENGTH = 5000;
  var USER_TEXT_ERROR =
    "Plain text only. HTML, code blocks, scripts and similar content are not allowed.";

  var USER_TEXT_RULES = [
    { re: /[\x00-\x08\x0B\x0C\x0E-\x1F]/, msg: "Text contains invalid control characters." },
    { re: /<\s*\/?\s*[a-zA-Z][^>]*>/, msg: USER_TEXT_ERROR },
    { re: /&lt;\s*\/?\s*[a-zA-Z]/i, msg: USER_TEXT_ERROR },
    { re: /(?:^|[\s"'(])javascript\s*:/i, msg: USER_TEXT_ERROR },
    { re: /(?:^|[\s"'(])data\s*:/i, msg: USER_TEXT_ERROR },
    { re: /(?:^|[\s"'(])vbscript\s*:/i, msg: USER_TEXT_ERROR },
    { re: /\bon[a-z]+\s*=/i, msg: USER_TEXT_ERROR },
    { re: /<\s*!\[CDATA\[/i, msg: USER_TEXT_ERROR },
    { re: /<%/, msg: USER_TEXT_ERROR },
    { re: /<\?php/i, msg: USER_TEXT_ERROR },
    { re: /```/, msg: USER_TEXT_ERROR },
    { re: /\beval\s*\(/i, msg: USER_TEXT_ERROR },
    { re: /\bnew\s+Function\s*\(/i, msg: USER_TEXT_ERROR }
  ];

  function validateUserText(text) {
    if (typeof text !== "string") {
      return { ok: false, message: USER_TEXT_ERROR };
    }
    if (text.length > MAX_USER_TEXT_LENGTH) {
      return { ok: false, message: "Text is too long (maximum " + MAX_USER_TEXT_LENGTH + " characters)." };
    }
    for (var i = 0; i < USER_TEXT_RULES.length; i++) {
      if (USER_TEXT_RULES[i].re.test(text)) {
        return { ok: false, message: USER_TEXT_RULES[i].msg };
      }
    }
    return { ok: true };
  }

  function sanitizeStoredComments(data) {
    Object.keys(data).forEach(function (id) {
      if (!data[id] || !data[id].comment) return;
      if (!validateUserText(data[id].comment).ok) data[id].comment = "";
    });
    return data;
  }

  /* ---------------------------- Results state ------------------------- */

  var state = loadState();

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? sanitizeStoredComments(JSON.parse(raw)) : {};
    } catch (e) {
      return {};
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getItemState(id) {
    return state[id] || { status: "none", comment: "" };
  }

  function setItemState(id, patch) {
    var cur = getItemState(id);
    if (patch.comment !== undefined) {
      var check = validateUserText(patch.comment);
      if (!check.ok) return false;
    }
    state[id] = {
      status: patch.status !== undefined ? patch.status : cur.status,
      comment: patch.comment !== undefined ? patch.comment : cur.comment
    };
    saveState();
    return true;
  }

  /* --------------------------- Checklist data ------------------------- */

  function loadData() {
    return fetch(DATA_URL, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  /* Persist checklist edits on the server so everyone sees them. */
  function saveData() {
    return fetch(SAVE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Editor-Password": editorPassword
      },
      body: JSON.stringify(HEALTHCHECK)
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
    }).catch(function (err) {
      alert(
        "Could not save the checklist to the server (" + (err.message || err) + ").\n\n" +
        "Make sure the site is running via \"python server.py\" (not a plain static file server), " +
        "then repeat the edit."
      );
    });
  }

  function newItemId() {
    return "itm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  /* Outline markers per depth: a. / i. / 1. / a. (as in the original outline) */

  function toRoman(n) {
    var pairs = [[10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    var out = "";
    pairs.forEach(function (p) {
      while (n >= p[0]) { out += p[1]; n -= p[0]; }
    });
    return out;
  }

  function toLetter(n) {
    var out = "";
    while (n > 0) {
      n--;
      out = String.fromCharCode(97 + (n % 26)) + out;
      n = Math.floor(n / 26);
    }
    return out;
  }

  function markerFor(depth, index) {
    var n = index + 1;
    if (depth === 1) return toRoman(n) + ".";
    if (depth === 2) return n + ".";
    return toLetter(n) + ".";
  }

  function renumber(items, depth) {
    items.forEach(function (item, i) {
      item.num = markerFor(depth, i);
      if (item.children) renumber(item.children, depth + 1);
    });
  }

  function renumberAll() {
    HEALTHCHECK.categories.forEach(function (cat) {
      renumber(cat.items, 0);
    });
  }

  function normalizeItem(item) {
    if (item.code) {
      item.commands = item.commands || [];
      item.commands.push(item.code);
      delete item.code;
    }
    if (item.children) item.children.forEach(normalizeItem);
  }

  function normalizeChecklist(data) {
    if (!data || !Array.isArray(data.categories)) return;
    if (typeof data.title !== "string" || !data.title.trim()) data.title = DEFAULT_TITLE;
    if (typeof data.description !== "string") data.description = DEFAULT_DESCRIPTION;
    data.categories.forEach(function (cat) {
      if (cat.items) cat.items.forEach(normalizeItem);
    });
  }

  function itemCommands(item) {
    if (item.commands && item.commands.length) return item.commands;
    return item.code ? [item.code] : [];
  }

  /* Locate an item's containing array + index by id. */
  function findItemRef(id) {
    var result = null;
    HEALTHCHECK.categories.forEach(function (cat) {
      var walk = function (arr) {
        arr.forEach(function (item, i) {
          if (item.id === id) result = { arr: arr, index: i, item: item, cat: cat };
          if (item.children) walk(item.children);
        });
      };
      walk(cat.items);
    });
    return result;
  }

  /* --------------------------- Data helpers --------------------------- */

  function flattenItems(items, out) {
    out = out || [];
    items.forEach(function (item) {
      out.push(item);
      if (item.children) flattenItems(item.children, out);
    });
    return out;
  }

  function categoryCounts(cat) {
    var counts = { none: 0, done: 0, wip: 0, attn: 0, total: 0 };
    flattenItems(cat.items).forEach(function (item) {
      counts[getItemState(item.id).status]++;
      counts.total++;
    });
    return counts;
  }

  function overallCounts() {
    var counts = { none: 0, done: 0, wip: 0, attn: 0, total: 0 };
    HEALTHCHECK.categories.forEach(function (cat) {
      var c = categoryCounts(cat);
      counts.none += c.none;
      counts.done += c.done;
      counts.wip += c.wip;
      counts.attn += c.attn;
      counts.total += c.total;
    });
    return counts;
  }

  function findCategory(route) {
    for (var i = 0; i < HEALTHCHECK.categories.length; i++) {
      if (HEALTHCHECK.categories[i].route === route) return HEALTHCHECK.categories[i];
    }
    return null;
  }

  /* ------------------------------ DOM utils --------------------------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function plainTextFromHtml(html) {
    if (!html) return "";
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || "";
  }

  function looksLikeHtml(text) {
    return /<\s*\/?\s*[a-zA-Z][^>]*>/.test(text) ||
      /&lt;\s*\/?\s*[a-zA-Z][^&]*&gt;/i.test(text);
  }

  function elHtml(tag, className, html) {
    var node = el(tag, className);
    if (html) node.innerHTML = html;
    return node;
  }

  function iconBtn(cls, icon, label, onClick) {
    var btn = el("button", cls);
    btn.type = "button";
    btn.innerHTML = icon;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", onClick);
    return btn;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (err) {
        reject(err);
      }
      document.body.removeChild(ta);
    });
  }

  function renderCommandBlock(cmd) {
    var block = el("div", "command-block");
    var code = el("code", "item-code");
    code.textContent = cmd;
    block.appendChild(code);

    var copyBtn = iconBtn("command-copy", COPY_ICON, "Copy command", function () {
      copyToClipboard(cmd).then(function () {
        copyBtn.title = "Copied!";
        copyBtn.setAttribute("aria-label", "Copied!");
        setTimeout(function () {
          copyBtn.title = "Copy command";
          copyBtn.setAttribute("aria-label", "Copy command");
        }, 2000);
      }).catch(function () {
        alert("Could not copy to the clipboard.");
      });
    });
    block.appendChild(copyBtn);
    return block;
  }

  /* Build a label span: HTML when the editor used markup, otherwise linkify URLs. */
  function renderItemLabel(text) {
    if (looksLikeHtml(text)) {
      return elHtml("span", "item-label rich-text", text);
    }
    return linkifyLabel(text);
  }

  function linkifyLabel(text) {
    var span = el("span", "item-label");
    var re = /https?:\/\/[^\s]+/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      var url = m[0].replace(/[.,;:)\]}]+$/, ""); // don't swallow trailing punctuation
      if (m.index > last) span.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = el("a", "", url);
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      span.appendChild(a);
      last = m.index + url.length;
    }
    span.appendChild(document.createTextNode(text.slice(last)));
    return span;
  }

  /* ------------------------------- Nav -------------------------------- */

  function renderNav(activeRoute) {
    var nav = document.getElementById("category-nav");
    nav.innerHTML = "";

    var overview = el("a", activeRoute === "" ? "active" : "", "Overview");
    overview.href = "#/";
    nav.appendChild(overview);

    HEALTHCHECK.categories.forEach(function (cat) {
      var link = el("a", cat.route === activeRoute ? "active" : "");
      link.href = "#/" + cat.route;
      link.appendChild(document.createTextNode(plainTextFromHtml(cat.short || cat.title)));

      var counts = categoryCounts(cat);
      if (counts.attn > 0) {
        link.appendChild(el("span", "nav-badge attn", String(counts.attn)));
      } else if (counts.done === counts.total && counts.total > 0) {
        link.appendChild(el("span", "nav-badge done", "\u2713"));
      }
      nav.appendChild(link);
    });
  }

  function renderTopbarProgress() {
    var counts = overallCounts();
    var pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
    document.getElementById("topbar-progress-fill").style.width = pct + "%";
    document.getElementById("topbar-progress-label").textContent = pct + "%";
  }

  function updateSiteTitle() {
    if (!HEALTHCHECK) return;
    var title = plainTextFromHtml(HEALTHCHECK.title || DEFAULT_TITLE);
    document.getElementById("topbar-title").textContent = title;
    document.title = title;
  }

  /* ------------------------------ Feedback ---------------------------- */

  /* Feedback is stored server-side and only readable in editor mode. */
  function loadFeedback() {
    if (!editorEnabled) return Promise.resolve();
    return fetch(FEEDBACK_URL, { headers: { "X-Editor-Password": editorPassword } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) { feedbackData = data; })
      .catch(function () { feedbackData = {}; });
  }

  function feedbackCount(itemId) {
    return feedbackData && feedbackData[itemId] ? feedbackData[itemId].length : 0;
  }

  /* Small generic popup, reusing the modal styling. Returns the body element. */
  function openPopup(title) {
    var overlay = el("div", "modal-overlay");
    var modal = el("div", "modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.appendChild(el("h2", "", title));
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(ev) {
      if (ev.key === "Escape") close();
    }
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);

    return { body: modal, close: close };
  }

  /* Popup for regular users to leave feedback about an item. */
  function openFeedbackForm(item) {
    var popup = openPopup("Leave feedback");
    var body = popup.body;

    body.appendChild(el("p", "", "Your feedback about this checklist topic is sent to the maintainers of the health check. It is not shown to other users."));
    body.appendChild(el("div", "feedback-item-ref", plainTextFromHtml(item.label)));

    var textarea = document.createElement("textarea");
    textarea.className = "feedback-input";
    textarea.rows = 4;
    textarea.placeholder = "Suggestions, corrections, questions\u2026";
    body.appendChild(textarea);

    var errorEl = el("div", "modal-error");
    errorEl.hidden = true;
    body.appendChild(errorEl);

    var actions = el("div", "modal-actions");
    var cancelBtn = el("button", "btn", "Cancel");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", popup.close);
    var sendBtn = el("button", "btn primary", "Send feedback");
    sendBtn.type = "button";
    actions.appendChild(cancelBtn);
    actions.appendChild(sendBtn);
    body.appendChild(actions);
    textarea.focus();

    textarea.addEventListener("input", function () {
      errorEl.hidden = true;
      textarea.classList.remove("input-invalid");
    });

    sendBtn.addEventListener("click", function () {
      var text = textarea.value.trim();
      if (!text) { textarea.focus(); return; }
      var check = validateUserText(text);
      if (!check.ok) {
        errorEl.textContent = check.message;
        errorEl.hidden = false;
        textarea.classList.add("input-invalid");
        textarea.focus();
        return;
      }
      sendBtn.disabled = true;
      fetch(FEEDBACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, text: text })
      }).then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (payload) {
            throw new Error(payload.error || ("HTTP " + res.status));
          });
        }
        body.innerHTML = "";
        body.appendChild(el("h2", "", "Thank you"));
        body.appendChild(el("p", "", "Your feedback has been recorded."));
        var okRow = el("div", "modal-actions");
        var okBtn = el("button", "btn primary", "Close");
        okBtn.type = "button";
        okBtn.addEventListener("click", popup.close);
        okRow.appendChild(okBtn);
        body.appendChild(okRow);
        okBtn.focus();
      }).catch(function (err) {
        sendBtn.disabled = false;
        var msg = err.message || String(err);
        if (/plain text|invalid control|too long/i.test(msg)) {
          errorEl.textContent = msg;
          errorEl.hidden = false;
          textarea.classList.add("input-invalid");
          textarea.focus();
        } else {
          alert("Could not send feedback (" + msg + "). Make sure the site is running via \"python server.py\".");
        }
      });
    });
  }

  function deleteFeedback(itemId, entryId) {
    return fetch(FEEDBACK_URL, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Editor-Password": editorPassword
      },
      body: JSON.stringify({ itemId: itemId, id: entryId })
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
    });
  }

  /* Popup for editors showing all feedback left on an item. */
  function openFeedbackViewer(item) {
    var popup = openPopup("Feedback");
    var body = popup.body;
    body.appendChild(el("div", "feedback-item-ref", plainTextFromHtml(item.label)));

    var list = el("div", "feedback-list");
    var emptyMsg = el("p", "", "No feedback for this item.");

    function refreshEmptyState() {
      var hasEntries = list.querySelector(".feedback-entry") !== null;
      emptyMsg.hidden = hasEntries;
    }

    var entries = (feedbackData && feedbackData[item.id]) || [];
    entries.forEach(function (entry) {
      var card = el("div", "feedback-entry");
      var head = el("div", "feedback-entry-head");
      var when = "";
      try { when = new Date(entry.at).toLocaleString(); } catch (e) { when = entry.at || ""; }
      head.appendChild(el("div", "feedback-when", when));
      if (entry.id) {
        head.appendChild(iconBtn("edit-btn danger feedback-delete", EDIT_ICONS.remove, "Delete feedback", function () {
          if (!confirm("Delete this feedback entry? This cannot be undone.")) return;
          deleteFeedback(item.id, entry.id).then(function () {
            feedbackData[item.id] = (feedbackData[item.id] || []).filter(function (e) {
              return e.id !== entry.id;
            });
            if (!feedbackData[item.id].length) delete feedbackData[item.id];
            card.remove();
            refreshEmptyState();
            route(); // refresh the count badges
          }).catch(function (err) {
            alert("Could not delete feedback (" + (err.message || err) + ").");
          });
        }));
      }
      card.appendChild(head);
      card.appendChild(el("div", "feedback-text", entry.text));
      list.appendChild(card);
    });
    body.appendChild(list);
    body.appendChild(emptyMsg);
    refreshEmptyState();

    var actions = el("div", "modal-actions");
    var closeBtn = el("button", "btn primary", "Close");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", popup.close);
    actions.appendChild(closeBtn);
    body.appendChild(actions);
  }

  /* Full page for editors listing all feedback across the whole checklist,
     grouped by checklist item (reachable via #/feedback). */
  function renderFeedbackPage() {
    var content = document.getElementById("content");
    content.innerHTML = "";

    var header = el("div", "page-header");
    header.appendChild(el("h1", "", "Feedback"));
    header.appendChild(el("p", "",
      "All feedback left by users of this health check, grouped by checklist item. " +
      "Only visible in editor mode."));
    content.appendChild(header);

    var list = el("div", "feedback-page-list");
    var emptyMsg = el("p", "feedback-empty", "No feedback has been left yet.");

    function refreshEmptyState() {
      var hasEntries = list.querySelector(".feedback-entry") !== null;
      emptyMsg.hidden = hasEntries;
    }

    function fill() {
      list.innerHTML = "";
      Object.keys(feedbackData || {}).forEach(function (itemId) {
        var entries = feedbackData[itemId] || [];
        if (!entries.length) return;

        var ref = findItemRef(itemId);
        var card = el("div", "card");
        var group = el("div", "card-body feedback-group");

        var refEl = el("div", "feedback-item-ref");
        if (ref) {
          var link = el("a", "", plainTextFromHtml(ref.cat.title) + " \u203a " +
            (ref.item.num ? ref.item.num + " " : "") + plainTextFromHtml(ref.item.label));
          link.href = "#/" + ref.cat.route;
          refEl.appendChild(link);
        } else {
          refEl.textContent = "(item no longer in the checklist)";
        }
        group.appendChild(refEl);

        entries.slice().forEach(function (entry) {
          var entryEl = el("div", "feedback-entry");
          var head = el("div", "feedback-entry-head");
          var when = "";
          try { when = new Date(entry.at).toLocaleString(); } catch (e) { when = entry.at || ""; }
          head.appendChild(el("div", "feedback-when", when));
          if (entry.id) {
            head.appendChild(iconBtn("edit-btn danger feedback-delete", EDIT_ICONS.remove, "Delete feedback", function () {
              if (!confirm("Delete this feedback entry? This cannot be undone.")) return;
              deleteFeedback(itemId, entry.id).then(function () {
                feedbackData[itemId] = (feedbackData[itemId] || []).filter(function (e) {
                  return e.id !== entry.id;
                });
                if (!feedbackData[itemId].length) delete feedbackData[itemId];
                entryEl.remove();
                if (!group.querySelector(".feedback-entry")) card.remove();
                refreshEmptyState();
              }).catch(function (err) {
                alert("Could not delete feedback (" + (err.message || err) + ").");
              });
            }));
          }
          entryEl.appendChild(head);
          entryEl.appendChild(el("div", "feedback-text", entry.text));
          group.appendChild(entryEl);
        });

        card.appendChild(group);
        list.appendChild(card);
      });
      refreshEmptyState();
    }

    content.appendChild(list);
    content.appendChild(emptyMsg);

    // Render what we have, then refresh from the server for the latest entries.
    fill();
    loadFeedback().then(function () {
      if (currentRoute() === "feedback") fill();
    });
  }

  /* --------------------------- Checklist item ------------------------- */

  var dragId = null; // id of the item currently being dragged
  var dragCatRoute = null; // route of the category card currently being dragged

  function clearDropMarkers() {
    document.querySelectorAll(".drop-above, .drop-below").forEach(function (n) {
      n.classList.remove("drop-above", "drop-below");
    });
  }

  // If a grip was pressed but no drag happened, make the item non-draggable again.
  document.addEventListener("mouseup", function () {
    document.querySelectorAll('.item[draggable="true"]').forEach(function (n) {
      if (!n.classList.contains("dragging")) n.removeAttribute("draggable");
    });
    document.querySelectorAll('.cat-card-wrap[draggable="true"]').forEach(function (n) {
      if (!n.classList.contains("dragging")) n.removeAttribute("draggable");
    });
  });

  /* Reordering by drag & drop is allowed between siblings (same parent). */
  function attachDragHandlers(wrap, row, item) {
    var handle = el("span", "drag-handle");
    handle.innerHTML = DRAG_ICON;
    handle.title = "Drag to reorder";
    // Only the grip initiates a drag, so text selection etc. keeps working.
    handle.addEventListener("mousedown", function () {
      wrap.setAttribute("draggable", "true");
    });
    row.insertBefore(handle, row.firstChild);

    function isBelow(ev) {
      var rect = row.getBoundingClientRect();
      return ev.clientY > rect.top + rect.height / 2;
    }

    wrap.addEventListener("dragstart", function (ev) {
      ev.stopPropagation();
      dragId = item.id;
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = "move";
        try { ev.dataTransfer.setData("text/plain", item.id); } catch (e) { /* IE */ }
      }
      wrap.classList.add("dragging");
    });

    wrap.addEventListener("dragend", function (ev) {
      ev.stopPropagation();
      wrap.classList.remove("dragging");
      wrap.removeAttribute("draggable");
      dragId = null;
      clearDropMarkers();
    });

    wrap.addEventListener("dragover", function (ev) {
      if (!dragId || dragId === item.id) return;
      var from = findItemRef(dragId);
      var to = findItemRef(item.id);
      if (!from || !to || from.arr !== to.arr) return; // only among siblings
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      clearDropMarkers();
      row.classList.add(isBelow(ev) ? "drop-below" : "drop-above");
    });

    wrap.addEventListener("dragleave", function () {
      row.classList.remove("drop-above", "drop-below");
    });

    wrap.addEventListener("drop", function (ev) {
      if (!dragId || dragId === item.id) return;
      var from = findItemRef(dragId);
      var to = findItemRef(item.id);
      clearDropMarkers();
      if (!from || !to || from.arr !== to.arr) return;
      ev.preventDefault();
      ev.stopPropagation();
      var below = isBelow(ev);
      var moved = from.arr.splice(from.index, 1)[0];
      var insertAt = from.arr.indexOf(item) + (below ? 1 : 0);
      from.arr.splice(insertAt, 0, moved);
      dragId = null;
      renumberAll();
      saveData();
      route();
    });
  }

  /* Reorder category cards on the overview page (editor mode). */
  function attachCategoryDragHandlers(wrap, cat) {
    var handle = el("span", "drag-handle");
    handle.innerHTML = DRAG_ICON;
    handle.title = "Drag to reorder";
    handle.addEventListener("mousedown", function () {
      wrap.setAttribute("draggable", "true");
    });
    wrap.insertBefore(handle, wrap.firstChild);

    function isBelow(ev) {
      var rect = wrap.getBoundingClientRect();
      return ev.clientY > rect.top + rect.height / 2;
    }

    wrap.addEventListener("dragstart", function (ev) {
      ev.stopPropagation();
      dragCatRoute = cat.route;
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = "move";
        try { ev.dataTransfer.setData("text/plain", cat.route); } catch (e) { /* IE */ }
      }
      wrap.classList.add("dragging");
    });

    wrap.addEventListener("dragend", function (ev) {
      ev.stopPropagation();
      wrap.classList.remove("dragging");
      wrap.removeAttribute("draggable");
      dragCatRoute = null;
      clearDropMarkers();
    });

    wrap.addEventListener("dragover", function (ev) {
      if (!dragCatRoute || dragCatRoute === cat.route) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      clearDropMarkers();
      wrap.classList.add(isBelow(ev) ? "drop-below" : "drop-above");
    });

    wrap.addEventListener("dragleave", function () {
      wrap.classList.remove("drop-above", "drop-below");
    });

    wrap.addEventListener("drop", function (ev) {
      if (!dragCatRoute || dragCatRoute === cat.route) return;
      var cats = HEALTHCHECK.categories;
      var fromCat = findCategory(dragCatRoute);
      clearDropMarkers();
      if (!fromCat) return;
      ev.preventDefault();
      ev.stopPropagation();
      var below = isBelow(ev);
      var moved = cats.splice(cats.indexOf(fromCat), 1)[0];
      var insertAt = cats.indexOf(cat) + (below ? 1 : 0);
      cats.splice(insertAt, 0, moved);
      dragCatRoute = null;
      saveData();
      route();
    });
  }

  function renderItem(item, depth) {
    var st = getItemState(item.id);

    var wrap = el("div", "item depth-" + depth + " status-" + st.status);
    wrap.dataset.id = item.id;

    var row = el("div", "item-row");
    attachDragHandlers(wrap, row, item);
    row.appendChild(el("span", "item-num", item.num || ""));

    var main = el("div", "item-main");
    main.appendChild(renderItemLabel(item.label));

    if (item.description) {
      main.appendChild(elHtml("div", "item-desc rich-text", item.description));
    }

    var commands = itemCommands(item);
    if (commands.length) {
      var commandsDiv = el("div", "item-commands");
      commands.forEach(function (cmd) {
        commandsDiv.appendChild(renderCommandBlock(cmd));
      });
      main.appendChild(commandsDiv);
    }

    if (item.links) {
      var linksDiv = el("div", "item-links");
      item.links.forEach(function (l) {
        var a = el("a");
        a.innerHTML = l.text || l.url;
        a.href = l.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        linksDiv.appendChild(a);
      });
      main.appendChild(linksDiv);
    }
    row.appendChild(main);

    var controls = el("div", "item-controls");

    var statusSelect = el("div", "status-select");
    STATUSES.forEach(function (s) {
      var btn = el("button", s.cls + (st.status === s.id ? " selected" : ""));
      btn.type = "button";
      btn.innerHTML = s.icon;
      btn.title = s.label;
      btn.setAttribute("aria-label", s.label);
      btn.addEventListener("click", function () {
        setItemState(item.id, { status: s.id });
        statusSelect.querySelectorAll("button").forEach(function (b) {
          b.classList.remove("selected");
        });
        btn.classList.add("selected");
        wrap.className = wrap.className.replace(/status-\w+/, "status-" + s.id);
        renderNav(currentRoute());
        renderTopbarProgress();
      });
      statusSelect.appendChild(btn);
    });
    controls.appendChild(statusSelect);

    var commentBox = el("div", "item-comment");
    var textarea = document.createElement("textarea");
    textarea.placeholder = "Add findings, notes or follow-ups\u2026";
    textarea.value = st.comment || "";
    commentBox.appendChild(textarea);

    var commentError = el("div", "field-error");
    commentError.hidden = true;
    commentBox.appendChild(commentError);

    var commentBtn = el("button", "comment-toggle" + (st.comment ? " has-comment" : ""), "Comment");
    commentBtn.type = "button";
    commentBtn.addEventListener("click", function () {
      commentBox.classList.toggle("open");
      if (commentBox.classList.contains("open")) textarea.focus();
    });
    textarea.addEventListener("input", function () {
      var check = validateUserText(textarea.value);
      if (!check.ok) {
        commentError.textContent = check.message;
        commentError.hidden = false;
        textarea.classList.add("input-invalid");
        return;
      }
      commentError.hidden = true;
      textarea.classList.remove("input-invalid");
      setItemState(item.id, { comment: textarea.value });
      commentBtn.classList.toggle("has-comment", textarea.value.trim() !== "");
    });
    controls.appendChild(commentBtn);

    // Feedback: users leave it, editors see it (with a count badge).
    var fbCount = editorEnabled ? feedbackCount(item.id) : 0;
    var fbBtn = el("button", "feedback-btn" + (editorEnabled && fbCount ? " has-feedback" : ""));
    fbBtn.type = "button";
    fbBtn.innerHTML = FEEDBACK_ICON + (editorEnabled && fbCount ? '<span class="feedback-count">' + fbCount + "</span>" : "");
    fbBtn.title = editorEnabled
      ? (fbCount ? fbCount + " feedback entr" + (fbCount === 1 ? "y" : "ies") : "No feedback")
      : "Leave feedback";
    fbBtn.setAttribute("aria-label", fbBtn.title);
    fbBtn.addEventListener("click", function () {
      if (editorEnabled) openFeedbackViewer(item);
      else openFeedbackForm(item);
    });
    controls.appendChild(fbBtn);

    // Editor-only controls (shown via CSS when body has .editor-on)
    var editControls = el("span", "edit-controls");
    editControls.appendChild(iconBtn("edit-btn", EDIT_ICONS.edit, "Edit item", function () {
      openInlineEdit(wrap, item);
    }));
    editControls.appendChild(iconBtn("edit-btn", EDIT_ICONS.add, "Add sub-item", function () {
      var child = { id: newItemId(), label: "New item" };
      item.children = item.children || [];
      item.children.push(child);
      renumberAll();
      saveData();
      pendingEditId = child.id;
      route();
    }));
    editControls.appendChild(iconBtn("edit-btn danger", EDIT_ICONS.remove, "Remove item", function () {
      var count = item.children ? flattenItems([item]).length : 1;
      var msg = count > 1
        ? 'Remove "' + plainTextFromHtml(item.label) + '" and its ' + (count - 1) + " sub-item(s)?"
        : 'Remove "' + plainTextFromHtml(item.label) + '"?';
      if (!confirm(msg)) return;
      var ref = findItemRef(item.id);
      if (ref) {
        ref.arr.splice(ref.index, 1);
        renumberAll();
        saveData();
        route();
      }
    }));
    controls.appendChild(editControls);

    row.appendChild(controls);
    wrap.appendChild(row);
    wrap.appendChild(commentBox);

    if (item.children) {
      var childrenWrap = el("div", "item-children");
      item.children.forEach(function (child) {
        childrenWrap.appendChild(renderItem(child, depth + 1));
      });
      wrap.appendChild(childrenWrap);
    }

    return wrap;
  }

  /* Replace an item's label with an inline editor for the text and its links. */
  function openInlineEdit(wrap, item) {
    var row = wrap.querySelector(".item-row");
    var main = row.querySelector(".item-main");
    if (main.querySelector(".inline-edit")) return;

    var label = main.querySelector(".item-label");
    label.style.display = "none";

    var descEl = main.querySelector(".item-desc");
    if (descEl) descEl.style.display = "none";

    var commandsEl = main.querySelector(".item-commands");
    if (commandsEl) commandsEl.style.display = "none";

    var editor = el("div", "inline-edit");
    var input = document.createElement("textarea");
    input.value = item.label;
    input.rows = 2;
    input.placeholder = "Item text";
    editor.appendChild(input);

    var descInput = document.createElement("textarea");
    descInput.value = item.description || "";
    descInput.placeholder = "Description (optional)";
    descInput.rows = 6;
    editor.appendChild(descInput);

    // Links editor: one row per link with display text, URL and a remove button.
    var linksWrap = el("div", "link-rows");
    function addLinkRow(text, url) {
      var lr = el("div", "link-row");
      var textIn = document.createElement("input");
      textIn.type = "text";
      textIn.placeholder = "Link text (optional)";
      textIn.value = text || "";
      var urlIn = document.createElement("input");
      urlIn.type = "text";
      urlIn.className = "link-url";
      urlIn.placeholder = "https://\u2026";
      urlIn.value = url || "";
      lr.appendChild(textIn);
      lr.appendChild(urlIn);
      lr.appendChild(iconBtn("edit-btn danger", EDIT_ICONS.remove, "Remove link", function () {
        lr.remove();
      }));
      linksWrap.appendChild(lr);
      return lr;
    }
    (item.links || []).forEach(function (l) { addLinkRow(l.text, l.url); });
    editor.appendChild(linksWrap);

    var commandsWrap = el("div", "command-rows");
    function addCommandRow(text) {
      var cr = el("div", "command-row");
      var cmdIn = document.createElement("textarea");
      cmdIn.placeholder = "Command example";
      cmdIn.rows = 6;
      cmdIn.value = text || "";
      cr.appendChild(cmdIn);
      cr.appendChild(iconBtn("edit-btn danger", EDIT_ICONS.remove, "Remove command", function () {
        cr.remove();
      }));
      commandsWrap.appendChild(cr);
      return cr;
    }
    itemCommands(item).forEach(function (cmd) { addCommandRow(cmd); });
    editor.appendChild(commandsWrap);

    var actions = el("div", "inline-edit-actions");
    var addLinkBtn = el("button", "btn small", "+ Add link");
    addLinkBtn.type = "button";
    addLinkBtn.addEventListener("click", function () {
      addLinkRow("", "").querySelector("input").focus();
    });
    var addCommandBtn = el("button", "btn small", "+ Add command");
    addCommandBtn.type = "button";
    addCommandBtn.addEventListener("click", function () {
      addCommandRow("").querySelector("textarea").focus();
    });
    var spacer = el("span", "flex-spacer");
    var saveBtn = el("button", "btn primary small", "Save");
    saveBtn.type = "button";
    var cancelBtn = el("button", "btn small", "Cancel");
    cancelBtn.type = "button";
    actions.appendChild(addLinkBtn);
    actions.appendChild(addCommandBtn);
    actions.appendChild(spacer);
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    editor.appendChild(actions);
    main.insertBefore(editor, main.firstChild);
    input.focus();
    input.select();

    function close() {
      editor.remove();
      label.style.display = "";
      if (descEl) descEl.style.display = "";
      if (commandsEl) commandsEl.style.display = "";
    }

    saveBtn.addEventListener("click", function () {
      var val = input.value.trim();
      if (val) item.label = val;

      var desc = descInput.value.trim();
      if (desc) item.description = desc;
      else delete item.description;

      var links = [];
      linksWrap.querySelectorAll(".link-row").forEach(function (lr) {
        var ins = lr.querySelectorAll("input");
        var text = ins[0].value.trim();
        var url = ins[1].value.trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        links.push({ text: text || url, url: url });
      });
      if (links.length) item.links = links;
      else delete item.links;

      var commands = [];
      commandsWrap.querySelectorAll(".command-row textarea").forEach(function (cmdIn) {
        var cmd = cmdIn.value.replace(/\r\n/g, "\n");
        if (cmd.trim()) commands.push(cmd);
      });
      if (commands.length) item.commands = commands;
      else {
        delete item.commands;
        delete item.code;
      }

      saveData();
      route();
    });
    cancelBtn.addEventListener("click", close);
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        saveBtn.click();
      }
    });
    editor.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") close();
      if (ev.key === "Enter" && ev.target.tagName === "INPUT") {
        ev.preventDefault();
        saveBtn.click();
      }
    });
  }

  /* ---------------------------- Category page ------------------------- */

  function renderCategoryPage(cat) {
    var content = document.getElementById("content");
    content.innerHTML = "";

    var header = el("div", "page-header");
    var titleRow = el("div", "page-title-row");
    titleRow.appendChild(elHtml("h1", "", cat.title));

    var catActions = el("span", "edit-controls");
    catActions.appendChild(iconBtn("edit-btn", EDIT_ICONS.edit, "Edit category", function () {
      openCategoryEdit(header, cat);
    }));
    catActions.appendChild(iconBtn("edit-btn danger", EDIT_ICONS.remove, "Delete category", function () {
      if (!confirm('Delete the category "' + plainTextFromHtml(cat.title) + '" and all its items?')) return;
      var idx = HEALTHCHECK.categories.indexOf(cat);
      if (idx >= 0) {
        HEALTHCHECK.categories.splice(idx, 1);
        saveData();
        window.location.hash = "#/";
      }
    }));
    titleRow.appendChild(catActions);
    header.appendChild(titleRow);

    header.appendChild(elHtml("p", "rich-text", cat.description || ""));
    header.appendChild(buildPillRow(categoryCounts(cat)));
    content.appendChild(header);

    cat.items.forEach(function (item) {
      var card = el("div", "card");
      var body = el("div", "card-body");
      body.appendChild(renderItem(item, 0));
      card.appendChild(body);
      content.appendChild(card);
    });

    var addWrap = el("div", "editor-add-row");
    var addBtn = el("button", "add-dashed", "+ Add item");
    addBtn.type = "button";
    addBtn.addEventListener("click", function () {
      var item = { id: newItemId(), label: "New item" };
      cat.items.push(item);
      renumberAll();
      saveData();
      pendingEditId = item.id;
      route();
    });
    addWrap.appendChild(addBtn);
    content.appendChild(addWrap);

    openPendingEdit();
  }

  /* Inline editing of category title + description. */
  function openCategoryEdit(header, cat) {
    if (header.querySelector(".inline-edit")) return;

    var editor = el("div", "inline-edit category-edit");
    var titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = cat.title;
    titleInput.placeholder = "Category title";
    var shortInput = document.createElement("input");
    shortInput.type = "text";
    shortInput.value = cat.short || "";
    shortInput.placeholder = "Short name (top bar)";
    var descInput = document.createElement("textarea");
    descInput.value = cat.description || "";
    descInput.placeholder = "Description";
    descInput.rows = 2;

    editor.appendChild(titleInput);
    editor.appendChild(shortInput);
    editor.appendChild(descInput);

    var actions = el("div", "inline-edit-actions");
    var saveBtn = el("button", "btn primary small", "Save");
    saveBtn.type = "button";
    var cancelBtn = el("button", "btn small", "Cancel");
    cancelBtn.type = "button";
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    editor.appendChild(actions);
    header.insertBefore(editor, header.firstChild);
    titleInput.focus();

    saveBtn.addEventListener("click", function () {
      if (titleInput.value.trim()) cat.title = titleInput.value.trim();
      cat.short = shortInput.value.trim() || cat.title;
      cat.description = descInput.value.trim();
      saveData();
      route();
    });
    cancelBtn.addEventListener("click", function () { editor.remove(); });
  }

  /* Inline editing of overview title + description. */
  function openOverviewEdit(header) {
    if (header.querySelector(".inline-edit")) return;

    var editor = el("div", "inline-edit category-edit");
    var titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = HEALTHCHECK.title || DEFAULT_TITLE;
    titleInput.placeholder = "Overview title";
    var descInput = document.createElement("textarea");
    descInput.value = HEALTHCHECK.description || DEFAULT_DESCRIPTION;
    descInput.placeholder = "Overview description";
    descInput.rows = 3;

    editor.appendChild(titleInput);
    editor.appendChild(descInput);

    var actions = el("div", "inline-edit-actions");
    var saveBtn = el("button", "btn primary small", "Save");
    saveBtn.type = "button";
    var cancelBtn = el("button", "btn small", "Cancel");
    cancelBtn.type = "button";
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    editor.appendChild(actions);
    header.insertBefore(editor, header.firstChild);
    titleInput.focus();

    saveBtn.addEventListener("click", function () {
      if (titleInput.value.trim()) HEALTHCHECK.title = titleInput.value.trim();
      HEALTHCHECK.description = descInput.value.trim();
      saveData();
      route();
    });
    cancelBtn.addEventListener("click", function () { editor.remove(); });
  }

  function openPendingEdit() {
    if (!pendingEditId) return;
    var id = pendingEditId;
    pendingEditId = null;
    var wrap = document.querySelector('.item[data-id="' + id + '"]');
    if (wrap) {
      var ref = findItemRef(id);
      if (ref) openInlineEdit(wrap, ref.item);
      wrap.scrollIntoView({ block: "center" });
    }
  }

  function buildPillRow(counts) {
    var row = el("div", "pill-row page-progress");
    [
      { key: "done", label: "checked off" },
      { key: "wip", label: "in progress" },
      { key: "attn", label: "needs attention" },
      { key: "none", label: "not checked" }
    ].forEach(function (p) {
      var pill = el("span", "pill p-" + p.key);
      pill.innerHTML = ICONS[p.key] + "<span>" + counts[p.key] + "</span>";
      pill.title = counts[p.key] + " " + p.label;
      row.appendChild(pill);
    });
    return row;
  }

  /* ---------------------------- Overview page ------------------------- */

  function renderOverviewPage() {
    var content = document.getElementById("content");
    content.innerHTML = "";

    var header = el("div", "page-header");
    var titleRow = el("div", "page-title-row");
    titleRow.appendChild(elHtml("h1", "", HEALTHCHECK.title || DEFAULT_TITLE));

    var overviewActions = el("span", "edit-controls");
    overviewActions.appendChild(iconBtn("edit-btn", EDIT_ICONS.edit, "Edit overview", function () {
      openOverviewEdit(header);
    }));
    titleRow.appendChild(overviewActions);
    header.appendChild(titleRow);

    header.appendChild(elHtml("p", "rich-text", HEALTHCHECK.description || DEFAULT_DESCRIPTION));
    header.appendChild(buildPillRow(overallCounts()));
    content.appendChild(header);

    var grid = el("div", "overview-grid");
    HEALTHCHECK.categories.forEach(function (cat) {
      var counts = categoryCounts(cat);
      var wrap = el("div", "cat-card-wrap");
      var card = el("a", "cat-card");
      card.href = "#/" + cat.route;

      var head = el("div", "cat-card-head");
      head.appendChild(elHtml("h2", "", cat.title));
      card.appendChild(head);
      card.appendChild(elHtml("div", "cat-desc rich-text", cat.description || ""));

      var track = el("div", "cat-progress-track");
      ["done", "wip", "attn"].forEach(function (key) {
        if (counts[key] > 0) {
          var seg = el("div", "seg-" + key);
          seg.style.width = (counts[key] / counts.total) * 100 + "%";
          track.appendChild(seg);
        }
      });
      card.appendChild(track);

      card.appendChild(buildPillRow(counts));
      wrap.appendChild(card);
      if (editorEnabled) attachCategoryDragHandlers(wrap, cat);
      grid.appendChild(wrap);
    });

    // Editor-only: add category card
    var addCard = el("button", "cat-card add-category add-dashed", "+ Add category");
    addCard.type = "button";
    addCard.addEventListener("click", function () {
      var title = prompt("Title for the new category:");
      if (!title || !title.trim()) return;
      title = title.trim();
      var base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "category";
      var routeId = base;
      var n = 2;
      while (findCategory(routeId)) routeId = base + "-" + n++;
      HEALTHCHECK.categories.push({
        id: routeId,
        route: routeId,
        title: title,
        short: title,
        description: "",
        items: []
      });
      saveData();
      window.location.hash = "#/" + routeId;
    });
    grid.appendChild(addCard);

    content.appendChild(grid);
  }

  /* --------------------------- Export / import ------------------------ */

  function downloadJson(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadFilenameStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  }

  function exportState() {
    downloadJson(
      { tool: "ocvs-healthcheck", exportedAt: new Date().toISOString(), state: state },
      "ocvs-healthcheck-" + downloadFilenameStamp() + ".json"
    );
  }

  function importStateFromFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var payload = JSON.parse(reader.result);
        var imported = payload && payload.state ? payload.state : payload;
        if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
          throw new Error("Unexpected format");
        }
        var removed = 0;
        Object.keys(imported).forEach(function (id) {
          if (!imported[id] || !imported[id].comment) return;
          if (!validateUserText(imported[id].comment).ok) {
            imported[id].comment = "";
            removed++;
          }
        });
        state = imported;
        saveState();
        route();
        if (removed) {
          alert("Some comments were removed because they contained disallowed content (HTML, code or scripts).");
        }
      } catch (e) {
        alert("Could not import this file: not a valid OCVS health check export.");
      }
    };
    reader.readAsText(file);
  }

  document.getElementById("import-file").addEventListener("change", function (ev) {
    var file = ev.target.files[0];
    if (file) importStateFromFile(file);
    ev.target.value = "";
  });

  /* ------------------------------ Editor mode ------------------------- */

  function setEditorEnabled(on, password) {
    editorEnabled = on;
    editorPassword = on ? (password || "") : "";
    if (on) sessionStorage.setItem(EDITOR_KEY_SESSION, editorPassword);
    else sessionStorage.removeItem(EDITOR_KEY_SESSION);
    document.body.classList.toggle("editor-on", on);
    updateMenu();
    if (on) {
      loadFeedback().then(route);
    } else {
      feedbackData = null;
      route();
    }
  }

  /* Older versions kept checklist edits only in this browser. If such edits
     exist when the editor is enabled, offer to publish them for everyone. */
  function migrateLegacyEdits() {
    var raw = localStorage.getItem(LEGACY_DATA_KEY);
    if (!raw) return;
    localStorage.removeItem(LEGACY_DATA_KEY);
    try {
      var legacy = JSON.parse(raw);
      if (!legacy || !Array.isArray(legacy.categories)) return;
      if (confirm(
        "This browser still has checklist edits that were saved locally by an earlier version " +
        "of this tool. Publish them to the server so everyone gets them?\n\n" +
        "(Choosing Cancel keeps the server version and discards the local edits.)"
      )) {
        HEALTHCHECK = legacy;
        normalizeChecklist(HEALTHCHECK);
        renumberAll();
        saveData();
        route();
      }
    } catch (e) { /* corrupt legacy data - nothing to migrate */ }
  }

  function openEditorModal() {
    var modal = document.getElementById("editor-modal");
    var input = document.getElementById("editor-password");
    var error = document.getElementById("editor-error");
    input.value = "";
    error.hidden = true;
    modal.hidden = false;
    input.focus();
  }

  function closeEditorModal() {
    document.getElementById("editor-modal").hidden = true;
  }

  (function initEditorModal() {
    var modal = document.getElementById("editor-modal");
    var input = document.getElementById("editor-password");
    var error = document.getElementById("editor-error");

    function submit() {
      var password = input.value;
      fetch(VERIFY_URL, {
        method: "POST",
        headers: { "X-Editor-Password": password }
      }).then(function (res) {
        if (res.ok) {
          closeEditorModal();
          setEditorEnabled(true, password);
          migrateLegacyEdits();
        } else if (res.status === 403) {
          error.hidden = false;
          input.select();
        } else {
          throw new Error("HTTP " + res.status);
        }
      }).catch(function (err) {
        alert(
          "Could not verify the editor password (" + (err.message || err) + ").\n\n" +
          "Make sure the site is running via \"python server.py\" (not a plain static file server)."
        );
      });
    }

    document.getElementById("editor-submit").addEventListener("click", submit);
    document.getElementById("editor-cancel").addEventListener("click", closeEditorModal);
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") submit();
      if (ev.key === "Escape") closeEditorModal();
    });
    modal.addEventListener("click", function (ev) {
      if (ev.target === modal) closeEditorModal();
    });
  })();

  /* --------------------------- Hamburger menu ------------------------- */

  function updateMenu() {
    var toggleItem = document.getElementById("menu-editor-toggle");
    toggleItem.childNodes[toggleItem.childNodes.length - 1].textContent =
      editorEnabled ? " Disable editor" : " Enable editor";
    document.getElementById("menu-editor-feedback").hidden = !editorEnabled;
    document.getElementById("menu-editor-download").hidden = !editorEnabled;
    document.getElementById("menu-editor-import").hidden = !editorEnabled;
  }

  function importChecklistFromFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.categories)) throw new Error("bad format");
        var ok = data.categories.every(function (cat) {
          return cat && typeof cat.title === "string" && typeof cat.route === "string" && Array.isArray(cat.items);
        });
        if (!ok) throw new Error("bad format");
        if (!confirm(
          "Replace the entire checklist with the contents of \"" + file.name + "\"?\n\n" +
          "This is saved to the server and affects everyone using the tool."
        )) return;
        HEALTHCHECK = data;
        normalizeChecklist(HEALTHCHECK);
        renumberAll();
        saveData();
        route();
      } catch (e) {
        alert("Could not import this file: not a valid checklist JSON (expected the format of data/healthcheck.json).");
      }
    };
    reader.readAsText(file);
  }

  document.getElementById("import-checklist-file").addEventListener("change", function (ev) {
    var file = ev.target.files[0];
    if (file) importChecklistFromFile(file);
    ev.target.value = "";
  });

  (function initMenu() {
    var toggle = document.getElementById("menu-toggle");
    var menu = document.getElementById("app-menu");

    function closeMenu() {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });

    document.addEventListener("click", function (ev) {
      if (!menu.hidden && !menu.contains(ev.target)) closeMenu();
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeMenu();
    });

    document.getElementById("menu-export").addEventListener("click", function () {
      closeMenu();
      exportState();
    });

    document.getElementById("menu-import").addEventListener("click", function () {
      closeMenu();
      document.getElementById("import-file").click();
    });

    document.getElementById("menu-reset").addEventListener("click", function () {
      closeMenu();
      if (confirm("Reset all statuses and comments? This cannot be undone.")) {
        state = {};
        saveState();
        route();
      }
    });

    document.getElementById("menu-editor-toggle").addEventListener("click", function () {
      closeMenu();
      if (editorEnabled) setEditorEnabled(false);
      else openEditorModal();
    });

    document.getElementById("menu-editor-feedback").addEventListener("click", function () {
      closeMenu();
      if (currentRoute() === "feedback") route(); // already there: refresh
      else window.location.hash = "#/feedback";
    });

    document.getElementById("menu-editor-download").addEventListener("click", function () {
      closeMenu();
      downloadJson(
        Object.assign({ exportedAt: new Date().toISOString() }, HEALTHCHECK),
        "healthcheck-" + downloadFilenameStamp() + ".json"
      );
    });

    document.getElementById("menu-editor-import").addEventListener("click", function () {
      closeMenu();
      document.getElementById("import-checklist-file").click();
    });
  })();

  /* ------------------------------- Router ----------------------------- */

  function currentRoute() {
    var hash = window.location.hash || "#/";
    return hash.replace(/^#\//, "");
  }

  function route() {
    if (!HEALTHCHECK) return;
    var r = currentRoute();
    var cat = findCategory(r);
    renderNav(cat ? cat.route : "");
    renderTopbarProgress();
    updateSiteTitle();
    if (cat) {
      renderCategoryPage(cat);
    } else if (r === "feedback" && editorEnabled) {
      renderFeedbackPage();
    } else {
      if (r !== "") window.location.hash = "#/";
      renderOverviewPage();
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", route);

  /* -------------------------------- Boot ------------------------------ */

  Promise.all([loadData(), loadFeedback()])
    .then(function (results) {
      HEALTHCHECK = results[0];
      normalizeChecklist(HEALTHCHECK);
      renumberAll();
      document.body.classList.toggle("editor-on", editorEnabled);
      updateMenu();
      route();
    })
    .catch(function (err) {
      document.getElementById("content").innerHTML =
        '<div class="card"><div class="card-body">' +
        "<h2>Could not load the checklist</h2>" +
        "<p>The checklist definition (<code>data/healthcheck.json</code>) could not be loaded (" +
        String(err.message || err) + "). " +
        "If you opened <code>index.html</code> directly from disk, please serve the folder instead, e.g. " +
        "<code>python -m http.server 8080</code> and browse to <a href=\"http://localhost:8080\">http://localhost:8080</a>.</p>" +
        "</div></div>";
    });
})();
