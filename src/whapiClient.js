'use strict';

const axios = require('axios');
const fs = require('fs');

const BASE_URL = 'https://gate.whapi.cloud';

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.WHAPI_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/** Normaliza número de teléfono al formato Whapi: 584121234567@s.whatsapp.net */
function toWhapiPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.startsWith('58') ? digits : `58${digits}`;
  return `${normalized}@s.whatsapp.net`;
}

async function apiCall(method, endpoint, data, retried = false) {
  try {
    const res = await axios({ method, url: `${BASE_URL}${endpoint}`, headers: getHeaders(), data });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    console.error(`[whapi] ${method.toUpperCase()} ${endpoint} → ${status}`, err.response?.data ?? err.message);
    if (!retried) {
      await new Promise(r => setTimeout(r, 1500));
      return apiCall(method, endpoint, data, true);
    }
    throw err;
  }
}

async function sendText(phone, text) {
  return apiCall('post', '/messages/text', {
    to: toWhapiPhone(phone),
    body: text,
  });
}

async function sendImage(phone, imagePathOrUrl, caption = '') {
  const isUrl = imagePathOrUrl.startsWith('http');
  const payload = {
    to: toWhapiPhone(phone),
    caption,
  };
  if (isUrl) {
    payload.media = imagePathOrUrl;
  } else {
    const fileData = fs.readFileSync(imagePathOrUrl);
    payload.media = `data:image/jpeg;base64,${fileData.toString('base64')}`;
  }
  return apiCall('post', '/messages/image', payload);
}

async function sendDocument(phone, filePath, filename, caption = '') {
  const fileData = fs.readFileSync(filePath);
  return apiCall('post', '/messages/document', {
    to: toWhapiPhone(phone),
    media: `data:application/pdf;base64,${fileData.toString('base64')}`,
    filename,
    caption,
  });
}

module.exports = { sendText, sendImage, sendDocument, toWhapiPhone };
