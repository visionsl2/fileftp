/**
 * 存储服务 (Storage Service)
 *
 * 功能说明：
 * - 文件存储和读取
 * - 目录管理
 * - 分片文件合并
 * - 文件哈希计算
 *
 * 存储策略：
 * - 统一使用正斜杠(/)存储路径，兼容Windows和Unix
 * - 用户文件存储在 uploads/{userId}/ 目录下
 * - 临时文件存储在 uploads/temp/{userId}/ 目录下
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
// sharp 是可选依赖（pkg 打包时可能无法包含原生模块）
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('[Storage] sharp not available, thumbnail generation disabled');
}
// ffmpeg 是可选依赖（NAS 可能未安装）
let ffmpeg;
try {
  ffmpeg = require('fluent-ffmpeg');
  // 如果配置了 FFMPEG_PATH，显式设置路径
  if (process.env.FFMPEG_PATH) {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
    console.log('[Storage] ffmpeg path:', process.env.FFMPEG_PATH);
  }
} catch (e) {
  console.warn('[Storage] ffmpeg not available, video thumbnail generation disabled');
}
const uploadConfig = require('../config/upload');

// 图片扩展名列表
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico'];

// 视频扩展名列表
const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm', '.m4v', '.3gp'];

class StorageService {
  /**
   * 确保目录存在
   * @param {string} dirPath - 目录路径
   */
  async ensureDir(dirPath) {
    try {
      await fsp.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  /**
   * 保存文件（从临时位置移动到目标位置）
   *
   * @param {string} tempPath - 临时文件路径
   * @param {string} userId - 用户ID
   * @param {string|null} folderId - 目标文件夹ID
   * @returns {Object} {path, relativePath}
   */
  async saveFile(tempPath, userId, folderId = null) {
    // 构建用户目录
    const userDir = path.join(uploadConfig.uploadDir, userId.toString());
    await this.ensureDir(userDir);

    // 构建目标目录（可选的子文件夹）
    const destDir = folderId
      ? path.join(userDir, folderId.toString())
      : userDir;
    await this.ensureDir(destDir);

    // 生成唯一文件名（时间戳+随机字符串+扩展名）
    const filename = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${path.extname(tempPath)}`;
    const destPath = path.join(destDir, filename);

    // 移动文件到目标位置
    await fsp.rename(tempPath, destPath);

    // 统一使用正斜杠存储路径，确保跨平台兼容
    const normalizedPath = destPath.replace(/\\/g, '/');

    return {
      path: normalizedPath,
      relativePath: path.relative(uploadConfig.uploadDir, normalizedPath)
    };
  }

  /**
   * 处理上传文件（formidable上传后直接处理）
   *
   * @param {string} filePath - 文件路径
   * @param {string} userId - 用户ID
   * @param {string|null} folderId - 目标文件夹ID
   * @param {string} ext - 文件扩展名
   * @returns {Object} {path, relativePath}
   */
  async processUploadedFile(filePath, userId, folderId = null, ext = '') {
    const userDir = path.join(uploadConfig.uploadDir, userId.toString());
    await this.ensureDir(userDir);

    const destDir = folderId
      ? path.join(userDir, folderId.toString())
      : userDir;
    await this.ensureDir(destDir);

    // 生成唯一文件名
    const filename = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
    const destPath = path.join(destDir, filename);

    // 移动文件
    await fsp.rename(filePath, destPath);

    // 统一使用正斜杠
    const normalizedPath = destPath.replace(/\\/g, '/');

    return {
      path: normalizedPath,
      relativePath: path.relative(uploadConfig.uploadDir, normalizedPath)
    };
  }

  /**
   * 合并分片文件
   *
   * @param {string} uploadId - 上传会话ID
   * @param {string} destPath - 目标文件路径
   */
  async mergeChunks(uploadId, destPath) {
    const chunksDir = path.join(uploadConfig.uploadDir, 'chunks', uploadId);

    try {
      // 读取所有分片
      const chunks = await fsp.readdir(chunksDir);
      // 按序号排序
      chunks.sort((a, b) => {
        return parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]);
      });

      // 确保目标目录存在
      await this.ensureDir(path.dirname(destPath));

      // 创建写入流
      const writeStream = fs.createWriteStream(destPath);

      // 依次写入每个分片
      for (const chunk of chunks) {
        const chunkPath = path.join(chunksDir, chunk);
        const chunkData = await fsp.readFile(chunkPath);
        writeStream.write(chunkData);
      }

      writeStream.end();

      // 等待写入完成
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // 删除分片目录
      await fsp.rm(chunksDir, { recursive: true, force: true });

      return destPath;
    } catch (error) {
      console.error('Merge chunks error:', error);
      throw error;
    }
  }

  /**
   * 删除文件
   * @param {string} filePath - 文件路径
   * @returns {boolean} 是否成功
   */
  async deleteFile(filePath) {
    try {
      await fsp.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 计算文件 SHA-256 哈希（流式，不占内存）
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} 64位十六进制字符串
   */
  async getFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 创建文件读取流
   * @param {string} filePath - 文件路径
   * @returns {ReadableStream}
   */
  createReadStream(filePath) {
    // 处理Windows反斜杠路径
    const normalizedPath = filePath.replace(/\\/g, '/');
    return fs.createReadStream(normalizedPath);
  }

  /**
   * 获取用户目录路径
   * @param {string} userId - 用户ID
   * @returns {string}
   */
  getUserDir(userId) {
    return path.join(uploadConfig.uploadDir, userId.toString());
  }

  /**
   * 检查是否为图片文件
   * @param {string} extension - 文件扩展名
   * @returns {boolean}
   */
  isImage(extension) {
    return IMAGE_EXTENSIONS.includes(extension.toLowerCase());
  }

  /**
   * 检查是否为视频文件
   * @param {string} extension - 文件扩展名
   * @returns {boolean}
   */
  isVideo(extension) {
    return VIDEO_EXTENSIONS.includes(extension.toLowerCase());
  }

  /**
   * 生成缩略图
   * @param {string} filePath - 原图路径
   * @param {string} fileId - 文件ID
   * @param {string} userId - 用户ID
   * @returns {Promise<{path: string, width: number, height: number}>}
   */
  async generateThumbnail(filePath, fileId, userId) {
    // sharp 不可用时跳过缩略图生成
    if (!sharp) {
      console.warn('[Storage] Skipping thumbnail (sharp not available):', fileId);
      return null;
    }

    // 缩略图尺寸
    const THUMB_WIDTH = 200;
    const THUMB_HEIGHT = 200;

    // 创建缩略图目录
    const thumbDir = path.join(uploadConfig.uploadDir, userId.toString(), 'thumbs');
    await this.ensureDir(thumbDir);

    // 缩略图文件名
    const thumbFilename = `${fileId}_thumb.jpg`;
    const thumbPath = path.join(thumbDir, thumbFilename);

    try {
      // 使用 sharp 生成缩略图
      const metadata = await sharp(filePath)
        .resize(THUMB_WIDTH, THUMB_HEIGHT, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);

      // 统一路径分隔符，返回相对路径（相对于 uploadDir）
      const normalizedPath = thumbPath.replace(/\\/g, '/');
      const relativePath = path.relative(uploadConfig.uploadDir, normalizedPath).replace(/\\/g, '/');

      return {
        path: relativePath,
        width: metadata.width,
        height: metadata.height
      };
    } catch (error) {
      console.error('Generate thumbnail error:', error);
      throw error;
    }
  }

  /**
   * 生成视频缩略图（截取第1秒帧）
   * @param {string} filePath - 视频文件路径（绝对路径）
   * @param {string} fileId - 文件ID
   * @param {string} userId - 用户ID
   * @returns {Promise<{path: string, width: number, height: number}>|null}
   */
  async generateVideoThumbnail(filePath, fileId, userId) {
    if (!ffmpeg) {
      console.warn('[Storage] Skipping video thumbnail (ffmpeg not available):', fileId);
      return null;
    }

    const thumbDir = path.join(uploadConfig.uploadDir, userId.toString(), 'thumbs');
    await this.ensureDir(thumbDir);

    const thumbFilename = `${fileId}_thumb.jpg`;
    const thumbPath = path.join(thumbDir, thumbFilename);

    return new Promise((resolve) => {
      ffmpeg(filePath)
        .screenshots({
          timestamps: ['00:00:01'],
          filename: thumbFilename,
          folder: thumbDir,
          size: '320x240'
        })
        .on('end', () => {
          const normalizedPath = thumbPath.replace(/\\/g, '/');
          const relativePath = path.relative(uploadConfig.uploadDir, normalizedPath).replace(/\\/g, '/');
          resolve({ path: relativePath, width: 320, height: 240 });
        })
        .on('error', (err) => {
          console.warn('[Storage] Video thumbnail failed:', err.message);
          // 尝试删除可能损坏的输出
          try { fs.unlinkSync(thumbPath); } catch {}
          resolve(null);
        });
    });
  }

  /**
   * 删除缩略图
   * @param {string} thumbPath - 缩略图路径
   */
  async deleteThumbnail(thumbPath) {
    if (!thumbPath) return;
    try {
      await fsp.unlink(this.resolvePath(thumbPath));
    } catch {
      // 忽略删除失败
    }
  }

  /**
   * 还原物理路径（从数据库中存储的相对路径拼接 uploadDir）
   *
   * 兼容旧数据：如果已是绝对路径则直接返回，不做拼接
   *
   * @param {string} storedPath - 数据库中存储的路径（相对或绝对）
   * @returns {string} 可用的物理绝对路径
   */
  resolvePath(storedPath) {
    if (!storedPath) return storedPath;
    // 修复反斜杠
    storedPath = storedPath.replace(/\\/g, '/');
    // 已是绝对路径：Unix 以 / 开头，Windows 以盘符如 C:/ 开头
    if (path.isAbsolute(storedPath) || /^[A-Za-z]:[/\\]/.test(storedPath)) {
      // 旧数据兼容：跨平台迁移时，去掉旧绝对路径的盘符和旧根目录，只保留相对部分
      // Z:/file_uploads/userId/folderId/file.mp4 → userId/folderId/file.mp4
      const match = storedPath.match(/^[A-Za-z]:\/[^/]+\/(.+)$/);
      if (match) {
        return path.join(uploadConfig.uploadDir, match[1]);
      }
      return storedPath;
    }
    return path.join(uploadConfig.uploadDir, storedPath);
  }

  /**
   * 移动孤儿文件（磁盘有但数据库无记录的文件）到 _orphan 文件夹
   * 不物理删除，管理员可手动审核后决定是否删除
   */
  async cleanOrphanFiles() {
    const File = require('../models/File');
    try {
      // 获取数据库中所有文件路径
      const dbFiles = await File.find({ isDeleted: false }, 'storage.path thumb.path').lean();
      const dbPaths = new Set();
      for (const f of dbFiles) {
        if (f.storage?.path) dbPaths.add(this.resolvePath(f.storage.path));
        if (f.thumb?.path) dbPaths.add(this.resolvePath(f.thumb.path));
      }

      // 扫描 uploads 目录，跳过 thumbs/temp/chunks/_orphan 子目录
      const uploadDir = uploadConfig.uploadDir;
      const orphanDir = path.join(uploadDir, '_orphan');
      let moved = 0;
      const scanDir = async (dir, depth = 0) => {
        if (depth > 4) return;
        try {
          const entries = await fsp.readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = path.join(dir, e.name);
            const normalized = full.replace(/\\/g, '/');
            if (e.isDirectory()) {
              if (!['thumbs', 'temp', 'chunks', '_orphan'].includes(e.name)) {
                await scanDir(full, depth + 1);
              }
            } else {
              if (!dbPaths.has(normalized)) {
                try {
                  await this.ensureDir(orphanDir);
                  const destName = Date.now() + '_' + e.name;
                  const dest = path.join(orphanDir, destName);
                  await fsp.rename(full, dest);
                  moved++;
                } catch {}
              }
            }
          }
        } catch {}
      };
      await scanDir(uploadDir);
      if (moved > 0) {
        console.log('[Storage] Moved', moved, 'unrecognized file(s) to _orphan/ (not deleted)');
      }
    } catch (e) {
      console.warn('[Storage] Orphan cleanup skipped:', e.message);
    }
  }
}

module.exports = new StorageService();
module.exports.IMAGE_EXTENSIONS = IMAGE_EXTENSIONS;
module.exports.VIDEO_EXTENSIONS = VIDEO_EXTENSIONS;