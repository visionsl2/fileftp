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
const uploadConfig = require('../config/upload');

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
   * 计算文件哈希（MD5）
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} 哈希值
   */
  async getFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
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
}

module.exports = new StorageService();