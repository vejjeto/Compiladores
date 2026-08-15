export const CLIENT_PROTOCOL_VERSION = 1;
export const CLIENT_MESSAGE_TYPES = Object.freeze({
  REQUEST: 'request',
  RESPONSE: 'response',
  EVENT: 'event',
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error'
});

export function buildRequest({ action, data = {}, requestId }) {
  return JSON.stringify({
    v: CLIENT_PROTOCOL_VERSION,
    type: CLIENT_MESSAGE_TYPES.REQUEST,
    action,
    data,
    requestId
  });
}

export function buildResponse({ requestId, ok = true, status = 200, data = null, error = null }) {
  return JSON.stringify({
    v: CLIENT_PROTOCOL_VERSION,
    type: CLIENT_MESSAGE_TYPES.RESPONSE,
    requestId,
    ok,
    status,
    data,
    error
  });
}

export function buildEvent({ event, data }) {
  return JSON.stringify({
    v: CLIENT_PROTOCOL_VERSION,
    type: CLIENT_MESSAGE_TYPES.EVENT,
    event,
    data
  });
}

export function buildPong() {
  return JSON.stringify({
    v: CLIENT_PROTOCOL_VERSION,
    type: CLIENT_MESSAGE_TYPES.PONG
  });
}

export function buildError({ requestId, message }) {
  return JSON.stringify({
    v: CLIENT_PROTOCOL_VERSION,
    type: CLIENT_MESSAGE_TYPES.ERROR,
    requestId,
    message
  });
}

export function parseClientMessage(payload) {
  if (typeof payload !== 'string') {
    return null;
  }

  const trimmed = payload.trim();

  if (!trimmed.startsWith('{')) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || parsed.v !== CLIENT_PROTOCOL_VERSION) {
    return null;
  }

  return parsed;
}