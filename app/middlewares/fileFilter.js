/**
 * 文件过滤器 (File Filter)
 *
 * 功能说明：
 * - 黑名单机制，禁止上传危险文件类型
 * - 检查文件扩展名和MIME类型
 * - 防止路径遍历攻击（文件名清洗）
 *
 * 安全考虑：
 * - 禁止脚本类文件（.js, .py, .php等）
 * - 禁止可执行文件（.exe, .dll等）
 * - 禁止服务器配置文件（.htaccess等）
 */

const path = require('path');

// 危险扩展名黑名单
const BLOCKED_EXTENSIONS = new Set([
  // JavaScript/TypeScript
  '.js', '.mjs', '.ts', '.tsx', '.jsx',
  // Python
  '.py', '.pyc', '.pyd',
  // PHP
  '.php', '.php3', '.php4', '.php5', '.phtml',
  // ASP
  '.asp', '.aspx', '.ascx', '.ashx',
  // JSP
  '.jsp', '.jspx', '.jspf',
  // Ruby
  '.rb', '.rake',
  // Shell脚本
  '.sh', '.bash', '.zsh',
  // Windows脚本
  '.bat', '.cmd', '.ps1', '.psm1',
  // 可执行文件
  '.exe', '.dll', '.com', '.scr', '.msi', '.vbs', '.vbe', '.ws', '.wsf',
  // CGI/Perl
  '.cgi', '.pl', '.perl',
  // 服务器配置
  '.htaccess', '.htpasswd',
  // 数据库
  '.sql', '.mdb',
  // 注册表
  '.reg',
  // Java
  '.jar', '.war', '.class',
  // Go/Rust/C/C++
  '.go', '.rs', '.c', '.cpp', '.h',
  // Apple
  '.swift', '.m', '.mm'
]);

// 危险MIME类型黑名单
const BLOCKED_MIME_TYPES = new Set([
  'application/x-javascript',
  'application/javascript',
  'text/javascript',
  'application/x-python',
  'text/x-python',
  'application/x-php',
  'text/php',
  'application/x-asp',
  'application/x-jsp',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-msdownload',
  'application/x-executable',
  'application/x-ruby',
  'text/x-shellscript'
]);

const fileFilter = {
  /**
   * 检查文件扩展名
   * @param {string} filename - 文件名
   * @returns {Object} {allowed: boolean, reason?: string}
   */
  checkExtension: (filename) => {
    const ext = path.extname(filename).toLowerCase();

    // 检查是否在黑名单中
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return {
        allowed: false,
        reason: `扩展名 ${ext} 被禁止上传，这是潜在的安全风险`
      };
    }

    return { allowed: true };
  },

  /**
   * 检查MIME类型
   * @param {string} mimeType - MIME类型
   * @returns {Object} {allowed: boolean, reason?: string}
   */
  checkMimeType: (mimeType) => {
    if (BLOCKED_MIME_TYPES.has(mimeType.toLowerCase())) {
      return {
        allowed: false,
        reason: `文件类型 ${mimeType} 被禁止上传`
      };
    }

    return { allowed: true };
  },

  /**
   * Multer文件过滤器中间件
   * @param {Object} req - Express请求对象
   * @param {Object} file - Multer文件对象
   * @param {Function} cb - 回调函数
   */
  filter: (req, file, cb) => {
    // 先检查扩展名
    const extResult = fileFilter.checkExtension(file.originalname);

    if (!extResult.allowed) {
      return cb(new Error(extResult.reason), false);
    }

    // 再检查MIME类型
    const mimeResult = fileFilter.checkMimeType(file.mimetype);

    if (!mimeResult.allowed) {
      return cb(new Error(mimeResult.reason), false);
    }

    cb(null, true);
  },

  /**
   * 清洗文件名，防止路径遍历攻击
   *
   * 处理策略：
   * - 只保留字母、数字、中文、下划线、连字符、点
   * - 替换路径遍历符号(..)
   * - 限制最大长度为255字符
   *
   * @param {string} filename - 原始文件名
   * @returns {string} 清洗后的文件名
   */
  sanitizeFilename: (filename) => {
    return filename
      .replace(/[^a-zA-Z0-9._-一-龥]/g, '_')  // 只保留允许的字符
      .replace(/\.\./g, '_')                           // 替换路径遍历
      .substring(0, 255);                               // 限制长度
  },

  /**
   * 获取被阻止的扩展名列表
   * @returns {Array} 扩展名字符串数组
   */
  getBlockedExtensions: () => {
    return Array.from(BLOCKED_EXTENSIONS);
  }
};

module.exports = fileFilter;