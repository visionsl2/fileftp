module.exports = {
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 1024 * 1024 * 1024,
  maxChunkSize: parseInt(process.env.MAX_CHUNK_SIZE) || 5 * 1024 * 1024,
  maxFilesPerRequest: parseInt(process.env.MAX_FILES_PER_REQUEST) || 10
};