const COLORS = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  BG_RED: '\x1b[41m',
  BG_GREEN: '\x1b[42m',
  BG_YELLOW: '\x1b[43m',
  BG_BLUE: '\x1b[44m'
};

const LEVEL_CONFIG = {
  INFO: { color: COLORS.CYAN, icon: 'ℹ', bg: '' },
  WARN: { color: COLORS.YELLOW, icon: '⚠', bg: '' },
  ERROR: { color: COLORS.RED, icon: '✗', bg: COLORS.BG_RED },
  DEBUG: { color: COLORS.DIM, icon: '◆', bg: '' },
  SUCCESS: { color: COLORS.GREEN, icon: '✓', bg: COLORS.BG_GREEN },
  EVENT: { color: COLORS.MAGENTA, icon: '●', bg: '' }
};

function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatMessage(component, level, message, data) {
  const timestamp = getTimestamp();
  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG.INFO;
  const componentStr = component ? `[${component}]` : '';
  const dataStr = data ? `\n    ${COLORS.DIM}${JSON.stringify(data, null, 2)}${COLORS.RESET}` : '';

  return `${COLORS.DIM}${timestamp}${COLORS.RESET} ${config.color}${config.icon} ${level.padEnd(7)}${COLORS.RESET} ${COLORS.BOLD}${componentStr}${COLORS.RESET} ${message}${dataStr}`;
}

export function log(component, level, message, data) {
  const formatted = formatMessage(component, level, message, data);
  console.log(formatted);
}

export function info(component, message, data) {
  log(component, 'INFO', message, data);
}

export function warn(component, message, data) {
  log(component, 'WARN', message, data);
}

export function error(component, message, data) {
  log(component, 'ERROR', message, data);
}

export function debug(component, message, data) {
  log(component, 'DEBUG', message, data);
}

export function success(component, message, data) {
  log(component, 'SUCCESS', message, data);
}

export function event(component, message, data) {
  log(component, 'EVENT', message, data);
}

export default { log, info, warn, error, debug, success, event };
