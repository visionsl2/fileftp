/**
 * 视图辅助函数 (View Helpers)
 *
 * 功能说明：
 * - 提供EJS模板中使用的格式化函数
 * - 文件大小格式化
 * - 日期格式化
 * - 文件图标获取
 */

module.exports = {
  /**
   * 格式化文件大小
   *
   * 将字节数转换为人类可读的大小字符串
   * 例如：1024 -> "1 KB"
   *
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的大小字符串
   */
  formatFileSize: (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  /**
   * 格式化日期
   *
   * 将Date对象转换为中文格式的日期时间字符串
   * 例如：2024-01-15 14:30
   *
   * @param {Date|string} date - 日期
   * @returns {string} 格式化后的日期字符串
   */
  formatDate: (date) => {
    const d = new Date(date);
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  /**
   * 获取文件图标SVG
   *
   * 根据文件扩展名返回对应的SVG图标
   *
   * @param {string} extension - 文件扩展名（如'.jpg'）
   * @returns {string} SVG图标HTML
   */
  getFileIcon: (extension) => {
    const icons = {
      image: '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
      video: '<svg viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>',
      audio: '<svg viewBox="0 0 24 24"><path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>',
      pdf: '<svg viewBox="0 0 24 24"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/></svg>',
      doc: '<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
      archive: '<svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2 6h-2v2h2v2h-2v2h-2v-2h2v-2h-2v-2h2v-2h-2V8h2v2h2v2z"/></svg>',
      code: '<svg viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>',
      default: '<svg viewBox="0 0 24 24"><path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"/></svg>'
    };

    extension = extension.toLowerCase();

    // 图片文件
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'].includes(extension)) return icons.image;
    // 视频文件
    if (['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm'].includes(extension)) return icons.video;
    // 音频文件
    if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'].includes(extension)) return icons.audio;
    // PDF
    if (extension === '.pdf') return icons.pdf;
    // 文档
    if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf'].includes(extension)) return icons.doc;
    // 压缩包
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'].includes(extension)) return icons.archive;
    // 代码文件
    if (['.html', '.css', '.xml', '.json', '.yaml', '.yml'].includes(extension)) return icons.code;

    return icons.default;
  },

  /**
   * 获取文件图标CSS类名
   *
   * @param {string} extension - 文件扩展名
   * @returns {string} CSS类名
   */
  getFileIconClass: (extension) => {
    extension = extension.toLowerCase();

    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'].includes(extension)) return 'icon-image';
    if (['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm'].includes(extension)) return 'icon-video';
    if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'].includes(extension)) return 'icon-audio';
    if (extension === '.pdf') return 'icon-pdf';
    if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf'].includes(extension)) return 'icon-doc';
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'].includes(extension)) return 'icon-archive';

    return 'icon-default';
  }
};