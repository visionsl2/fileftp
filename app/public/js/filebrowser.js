document.addEventListener('DOMContentLoaded', () => {
  const fileBrowser = new FileBrowser();
  window.fileBrowser = fileBrowser;
});

class FileBrowser {
  constructor() {
    this.currentFolder = document.querySelector('input[name="folder"]')?.value || '';
    this.viewMode = localStorage.getItem('viewMode') || 'grid';
    this.init();
  }

  init() {
    this.bindUploadEvents();
    this.bindViewToggle();
    this.bindFolderEvents();
    this.bindFileEvents();
    this.bindRefreshEvent();
    this.applyViewMode();
  }

  bindUploadEvents() {
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');
    const uploadPanel = document.getElementById('uploadPanel');
    const closePanel = document.getElementById('closeUploadPanel');

    uploadBtn?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.uploadFiles(e.target.files);
      }
    });

    closePanel?.addEventListener('click', () => {
      uploadPanel?.classList.remove('show');
    });

    document.getElementById('newFolderBtn')?.addEventListener('click', () => {
      this.createFolder();
    });
  }

  bindViewToggle() {
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.setViewMode(view);
      });
    });
  }

  bindFolderEvents() {
    // 单击打开文件夹
    document.querySelectorAll('.folder-item').forEach(item => {
      item.addEventListener('click', () => {
        const folderId = item.dataset.id;
        this.navigateToFolder(folderId);
      });
    });

    document.querySelectorAll('.rename-folder').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const folderId = btn.dataset.id;
        this.renameFolder(folderId);
      });
    });

    document.querySelectorAll('.delete-folder').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const folderId = btn.dataset.id;
        this.deleteFolder(folderId);
      });
    });
  }

  bindFileEvents() {
    document.querySelectorAll('.delete-file').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const fileId = btn.dataset.id;
        this.deleteFile(fileId);
      });
    });
  }

  bindRefreshEvent() {
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
      this.refresh();
    });
  }

  applyViewMode() {
    const fileList = document.getElementById('fileList');
    if (fileList) {
      fileList.dataset.view = this.viewMode;
    }

    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === this.viewMode);
    });
  }

  setViewMode(view) {
    this.viewMode = view;
    localStorage.setItem('viewMode', view);
    this.applyViewMode();
  }

  navigateToFolder(folderId) {
    const url = `/files?folder=${folderId}`;
    window.location.href = url;
  }

  async createFolder() {
    const name = prompt('请输入文件夹名称:');
    if (!name || !name.trim()) return;

    try {
      const res = await fetch('/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          parent: this.currentFolder || null
        })
      });

      const data = await res.json();

      if (data.success) {
        location.reload();
      } else {
        alert(data.message || '创建失败');
      }
    } catch (error) {
      console.error('Create folder error:', error);
      alert('创建文件夹失败');
    }
  }

  async renameFolder(folderId) {
    const folder = document.querySelector(`.folder-item[data-id="${folderId}"] .file-name`);
    const currentName = folder?.textContent || '';
    const newName = prompt('请输入新名称:', currentName);

    if (!newName || newName === currentName) return;

    try {
      const res = await fetch(`/folders/${folderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });

      const data = await res.json();

      if (data.success) {
        location.reload();
      } else {
        alert(data.message || '重命名失败');
      }
    } catch (error) {
      console.error('Rename folder error:', error);
      alert('重命名失败');
    }
  }

  async deleteFolder(folderId) {
    if (!confirm('确定要删除此文件夹吗？文件夹内的文件也会被删除。')) return;

    try {
      const res = await fetch(`/folders/${folderId}`, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (data.success) {
        location.reload();
      } else {
        alert(data.message || '删除失败');
      }
    } catch (error) {
      console.error('Delete folder error:', error);
      alert('删除失败');
    }
  }

  async deleteFile(fileId) {
    if (!confirm('确定要删除此文件吗？')) return;

    try {
      const res = await fetch(`/files/${fileId}`, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (data.success) {
        const fileItem = document.querySelector(`.file-item-row[data-id="${fileId}"]`);
        fileItem?.remove();
      } else {
        alert(data.message || '删除失败');
      }
    } catch (error) {
      console.error('Delete file error:', error);
      alert('删除失败');
    }
  }

  refresh() {
    const currentUrl = new URL(window.location.href);
    window.location.href = currentUrl.pathname + currentUrl.search;
  }

  async uploadFiles(files) {
    const uploadPanel = document.getElementById('uploadPanel');
    const uploadList = document.getElementById('uploadList');

    if (uploadPanel) uploadPanel.classList.add('show');
    if (uploadList) uploadList.innerHTML = '';

    const formData = new FormData();
    formData.append('folder', this.currentFolder || '');

    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    const uploadItem = document.createElement('div');
    uploadItem.className = 'upload-item';
    uploadItem.innerHTML = `
      <div class="upload-item-name">正在上传 ${files.length} 个文件...</div>
      <div class="upload-progress">
        <div class="upload-progress-bar" style="width: 0%"></div>
      </div>
      <div class="upload-item-status">准备中...</div>
    `;
    uploadList?.appendChild(uploadItem);

    const progressBar = uploadItem.querySelector('.upload-progress-bar');
    const statusText = uploadItem.querySelector('.upload-item-status');
    const nameText = uploadItem.querySelector('.upload-item-name');

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        if (progressBar) progressBar.style.width = percent + '%';
        if (statusText) statusText.textContent = `${percent}% (${formatSize(e.loaded)} / ${formatSize(e.total)})`;
      }
    });

    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.success) {
          if (statusText) {
            statusText.textContent = '上传成功';
            statusText.className = 'upload-item-status success';
          }
          if (progressBar) progressBar.style.width = '100%';

          setTimeout(() => {
            location.reload();
          }, 500);
        } else {
          if (statusText) {
            statusText.textContent = data.message || '上传失败';
            statusText.className = 'upload-item-status error';
          }
        }
      } catch {
        if (statusText) {
          statusText.textContent = '上传失败';
          statusText.className = 'upload-item-status error';
        }
      }
    });

    xhr.addEventListener('error', () => {
      if (statusText) {
        statusText.textContent = '网络错误';
        statusText.className = 'upload-item-status error';
      }
    });

    const token = getCookie('token');
    xhr.open('POST', '/files/upload');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
  }
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}