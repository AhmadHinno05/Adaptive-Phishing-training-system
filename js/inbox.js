/* =====================================================================
   inbox.js — Student / Employee inbox (inbox.html)
   Email list, answering, feedback, adaptive difficulty, My History,
   and weakness-based recommendations.
   ===================================================================== */

let currentEmail = null;   // scenario shown on the right
let startTime = 0;         // when it was opened (for response time)
let locked = false;        // true after the user answered
let lastResult = null;     // { isCorrect, change, level, progress }
let tipType = "";          // "sender", "link" or ""
let emptyKey = "selectEmail";
let answeredIds = [];
let historyOpen = false;

const PHISH_TO_ADVANCE = 4;   // correctly flagged phishing emails needed to move up one level

/** All saved attempts of one user. */
function getUserAttempts(user) { return attempts.filter(a => a.email === user.email); }

/** The category this learner should practise next ("" when there is no weakness yet). */
function getRecommendedCategory(user) {
  const weak = getWeakestCategory(getUserAttempts(user), true, 2);
  return weak && weak.rate < 100 ? weak.key : "";
}

/** Tag for an inbox email: "recommended" (weakest category) or "". */
function emailTag(s, user) {
  return s.category === getRecommendedCategory(user) ? "recommended" : "";
}

/** Inbox list = emails of the user's level; emails from the weakest category come first (FR-06). */
function getFilteredEmails() {
  const user = getUser();
  const recCat = getRecommendedCategory(user);
  const first = [], rest = [];
  for (let i = 0; i < scenarios.length; i++) {
    if (scenarios[i].level !== user.level) continue;
    if (scenarios[i].category === recCat) first.push(scenarios[i]);
    else rest.push(scenarios[i]);
  }
  return first.concat(rest);
}

/** Draws the level badge, the score and the email list on the left. */
function renderInbox() {
  const user = getUser();
  $("levelBadge").textContent = t("level") + ": " + levelName(user.level);
  $("scoreText").textContent = t("score") + ": " + countRight(getUserAttempts(user));

  const list = $("emailList");
  list.innerHTML = "";
  const rec = getRecommendedCategory(user);
  if (rec) list.appendChild(el("div", "rec-note", t("recNote") + " " + catName(rec)));

  getFilteredEmails().forEach(s => {
    const item = el("div", "mail-item" + (answeredIds.includes(s.id) ? " done" : "") + (currentEmail && currentEmail.id === s.id ? " active" : ""));
    item.appendChild(el("div", "sender", s.sender));
    item.appendChild(el("div", "subject", pick(s.titleEn, s.titleAr)));
    if (emailTag(s, user)) item.appendChild(el("span", "tag tag-recommended", t("recTag")));
    item.onclick = () => openEmail(s.id);
    list.appendChild(item);
  });
}

/** Opens an email on the right and starts the response timer. */
function openEmail(id) {
  if (answeredIds.includes(id)) return;          // already answered
  currentEmail = scenarios.find(s => s.id === id);
  startTime = Date.now();
  locked = false;
  lastResult = null;
  tipType = "";
  emptyKey = "selectEmail";                      // keep the empty-state message clean
  refreshInbox();
}

/** Draws the open email (subject, sender, body) and the answer buttons. */
function renderMail() {
  const hasMail = currentEmail !== null;
  $("mailSubject").textContent = hasMail ? pick(currentEmail.titleEn, currentEmail.titleAr) : t(emptyKey);
  $("mailSender").textContent = hasMail ? t("from") + ": " + currentEmail.sender : "";
  $("mailBody").textContent = hasMail ? pick(currentEmail.bodyEn, currentEmail.bodyAr) : (emptyKey === "allDone" ? t("allDoneBody") : "");
  $("btnPhish").disabled = $("btnLegit").disabled = !hasMail || locked;
}

/** Draws the feedback box (result, explanation, notes and the sender/link tip). */
function renderFeedback() {
  if (!lastResult || !currentEmail) return show("feedbackBox", false);
  show("feedbackBox", true);
  $("feedbackBox").className = "feedback " + (lastResult.isCorrect ? "ok" : "bad");
  $("resultTitle").textContent = t(lastResult.isCorrect ? "correct" : "incorrect") + " " + t(currentEmail.isPhishing ? "wasPhish" : "wasLegit");
  $("resultReason").textContent = pick(currentEmail.reasonEn, currentEmail.reasonAr);

  // Notes are built from keys here, so they follow the language toggle
  const notes = [];
  if (lastResult.change === "up")   notes.push(t("levelUp") + " " + levelName(lastResult.level));
  if (lastResult.change === "down") notes.push(t("levelDown") + " " + levelName(lastResult.level));
  const topLevel = levelOrder[levelOrder.length - 1];
  if (!lastResult.change && lastResult.level !== topLevel)       // progress towards the next level
    notes.push(t("levelProgress") + " " + lastResult.progress + "/" + PHISH_TO_ADVANCE);
  $("levelNote").textContent = notes.join(" ");


  const phish = currentEmail.isPhishing;
  if (tipType === "sender") $("tipText").textContent = t("from") + ": " + currentEmail.sender + " — " + t(phish ? "tipSenderPhish" : "tipSenderLegit");
  if (tipType === "link")   $("tipText").textContent = t(phish ? "tipLinkPhish" : "tipLinkLegit");
  show("tipText", tipType !== "");
}

/** Redraws everything on the inbox page. */
function refreshInbox() {
  renderInbox();
  renderMail();
  renderFeedback();
  renderHistory();
}

/**
 * Adaptive difficulty:
 *  - correctly flagging PHISH_TO_ADVANCE (4) phishing emails = level up (Easy > Medium > Hard)
 *  - 2 mistakes in a row = level down
 * Returns "up", "down" or "" (no change).
 */
function updateDifficulty(user, isCorrect, wasPhishing) {
  const old = levelOrder.indexOf(user.level);
  let now = old;

  if (isCorrect) {
    user.mistakes = 0;
    if (wasPhishing) user.phishCorrect = (user.phishCorrect || 0) + 1;     // only phishing emails count
    if (user.phishCorrect >= PHISH_TO_ADVANCE) now = Math.min(old + 1, levelOrder.length - 1);
  } else {
    user.mistakes = (user.mistakes || 0) + 1;
    if (user.mistakes >= 2) now = Math.max(old - 1, 0);
  }
  if (now === old) return "";

  user.level = levelOrder[now];
  user.phishCorrect = user.mistakes = 0;                                    // start the new level fresh
  return now > old ? "up" : "down";
}

/** Called by the two answer buttons: saves the attempt and adjusts the level. */
function checkAnswer(userPickedPhishing) {
  if (!currentEmail || locked) return;
  locked = true;

  const user = getUser();
  const isCorrect = userPickedPhishing === currentEmail.isPhishing;
  attempts.push({
    email: user.email, scenarioId: currentEmail.id, category: currentEmail.category, level: currentEmail.level,
    isCorrect, seconds: Math.max(1, Math.round((Date.now() - startTime) / 1000)), time: Date.now()
  });
  save("attempts", attempts);
  answeredIds.push(currentEmail.id);

  const change = updateDifficulty(user, isCorrect, currentEmail.isPhishing);
  save("users", users);

  lastResult = { isCorrect, change, level: user.level, progress: user.phishCorrect || 0 };
  tipType = "";
  refreshInbox();
}

/** Shows the "sender" or "link" tip under the feedback. */
function showTip(type) {
  tipType = type;
  renderFeedback();
}

/** Opens the next unanswered email; when all are done, shows a message and starts over. */
function nextEmail() {
  const next = getFilteredEmails().find(s => !answeredIds.includes(s.id));
  if (next) return openEmail(next.id);
  answeredIds = [];
  currentEmail = lastResult = null;
  locked = false;
  emptyKey = "allDone";
  refreshInbox();
}

/** Opens or closes the "My History" panel (FR-07). */
function toggleHistory() {
  historyOpen = !historyOpen;
  renderHistory();
  if (historyOpen) $("historyBox").scrollIntoView({ behavior: "smooth" });
}

/** Draws the history panel: summary cards and a table of the last 50 attempts. */
function renderHistory() {
  $("historyBox").classList.toggle("hidden", !historyOpen);
  if (!historyOpen) return;

  const user = getUser(), mine = getUserAttempts(user);
  const secs = mine.reduce((sum, a) => sum + a.seconds, 0);
  $("histAttempts").textContent = mine.length;
  $("histRate").textContent = percent(countRight(mine), mine.length) + "%";
  $("histAvg").textContent = mine.length ? Math.round(secs / mine.length) + t("sec") : "—";
  $("histLevel").textContent = levelName(user.level);
  show("historyEmpty", mine.length === 0);

  const body = $("historyTable");
  body.innerHTML = "";
  [...mine].reverse().slice(0, 50).forEach(a => {                 // newest first
    const s = scenarios.find(x => x.id === a.scenarioId);
    addRow(body, [fmtDate(a.time), s ? pick(s.titleEn, s.titleAr) : catName(a.category), catName(a.category), levelName(a.level),
      t(a.isCorrect ? "ok" : "wrong"), a.seconds + t("sec")], { 4: a.isCorrect ? "res-ok" : "res-bad" });
  });
}

pages.inbox = refreshInbox;   // lets core.js redraw this page after a language change
