'use strict';

// sessions: Map<phone, SessionState>
// SessionState: { state, data, history, reminderTimer, expireTimer }
const sessions = new Map();

const REMINDER_MS = 30 * 60 * 1000;  // 30 min → recordatorio
const EXPIRE_MS   = 60 * 60 * 1000;  // 60 min → cierre automático

let _onReminder = null;  // callback(phone) registrado por conversation.js
let _onExpire   = null;

function setCallbacks({ onReminder, onExpire }) {
  _onReminder = onReminder;
  _onExpire   = onExpire;
}

function _clearTimers(phone) {
  const s = sessions.get(phone);
  if (!s) return;
  clearTimeout(s.reminderTimer);
  clearTimeout(s.expireTimer);
}

function _resetTimers(phone) {
  _clearTimers(phone);
  const s = sessions.get(phone);
  if (!s) return;

  s.reminderTimer = setTimeout(() => {
    _onReminder?.(phone);
  }, REMINDER_MS);

  s.expireTimer = setTimeout(() => {
    sessions.delete(phone);
    _onExpire?.(phone);
  }, EXPIRE_MS);
}

function getSession(phone) {
  return sessions.get(phone) ?? null;
}

function createSession(phone, initialState = 'WELCOME') {
  _clearTimers(phone);
  const session = {
    state:   initialState,
    data:    {},
    history: [],         // stack de estados anteriores para "corregir"
    reminderTimer: null,
    expireTimer:   null,
  };
  sessions.set(phone, session);
  _resetTimers(phone);
  return session;
}

function updateState(phone, newState, newData = {}) {
  const s = sessions.get(phone);
  if (!s) return;
  s.history.push(s.state);
  s.state = newState;
  Object.assign(s.data, newData);
  _resetTimers(phone);
}

function goBack(phone) {
  const s = sessions.get(phone);
  if (!s || s.history.length === 0) return null;
  s.state = s.history.pop();
  _resetTimers(phone);
  return s.state;
}

function clearSession(phone) {
  _clearTimers(phone);
  sessions.delete(phone);
}

function touchSession(phone) {
  if (sessions.has(phone)) _resetTimers(phone);
}

module.exports = { setCallbacks, getSession, createSession, updateState, goBack, clearSession, touchSession };
