document.addEventListener('DOMContentLoaded', () => {
  const fileBrowser = new FileBrowser();
  window.fileBrowser = fileBrowser;
});

class FileBrowser {
  constructor() {
    const urlParams = new URLSearchParams(window.location.search);
    this.currentFolder = urlParams.get('folder') || '';
    this.viewMode = localStorage.getItem('viewMode') || 'grid';
    this.selectedFiles = new Set();
    this.selectedFolderItem = null;
    this.init();
  }

  init() {
    this.bindUploadEvents();
    this.bindViewToggle();
    this.bindFolderEvents();
    this.bindFileEvents();
    this.bindRefreshEvent();
    this.bindSelectionEvents();
    this.bindBatchActions();
    this.bindDragMove();
    this.initDragDrop();
    this.initImagePreview();
    this.initModals();
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
    // 只处理文件列表中的文件夹项（有 data-type="folder"）
    document.querySelectorAll('.folder-item[data-type="folder"]').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('action-btn') || e.target.closest('.action-btn')) return;
        const folderId = item.dataset.id;
        this.navigateToFolder(folderId);
      });
    });

    document.querySelectorAll('.rename-folder').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const folderId = btn.dataset.id;
        this.showRenameModal('folder', folderId, btn.closest('.folder-item').querySelector('.file-name')?.textContent || '');
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

    // Rename file button
    document.querySelectorAll('.file-item-row[data-type="file"]').forEach(item => {
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const fileId = item.dataset.id;
        const fileName = item.querySelector('.file-name')?.textContent || '';
        this.showRenameModal('file', fileId, fileName);
      });
    });
  }

  bindRefreshEvent() {
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
      this.refresh();
    });
  }

  // Selection handling
  bindSelectionEvents() {
    document.querySelectorAll('.file-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const fileId = checkbox.dataset.id;
        if (checkbox.checked) {
          this.selectedFiles.add(fileId);
          checkbox.closest('.file-item')?.classList.add('selected');
        } else {
          this.selectedFiles.delete(fileId);
          checkbox.closest('.file-item')?.classList.remove('selected');
        }
        this.updateBatchActions();
      });
    });

    // Click on file item should not toggle checkbox (only checkbox click does)
    document.querySelectorAll('.file-item-row').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('file-checkbox')) return;
        if (e.target.closest('.file-actions') || e.target.closest('.file-thumb-container')) return;
        // Could implement click to preview here
      });
    });
  }

  // Batch actions handling
  bindBatchActions() {
    const moveBtn = document.getElementById('moveSelectedBtn');
    const shareBtn = document.getElementById('shareSelectedBtn');

    moveBtn?.addEventListener('click', () => {
      if (this.selectedFiles.size > 0) {
        this.showMoveModal();
      }
    });

    shareBtn?.addEventListener('click', () => {
      if (this.selectedFiles.size > 0) {
        this.showShareModal();
      }
    });
  }

  updateBatchActions() {
    const batchActions = document.getElementById('batchActions');
    const selectedCount = document.getElementById('selectedCount');
    const count = this.selectedFiles.size;

    if (batchActions && selectedCount) {
      if (count > 0) {
        batchActions.style.display = 'flex';
        selectedCount.textContent = `已选择 ${count} 项`;
      } else {
        batchActions.style.display = 'none';
      }
    }
  }

  // Drag to move files
  bindDragMove() {
    let draggedFileIds = [];

    document.querySelectorAll('.file-item-row[draggable="true"]').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        // 获取所有被选中的文件
        const checkedBoxes = document.querySelectorAll('.file-checkbox:checked');
        if (checkedBoxes.length > 0) {
          // 移动所有选中的文件
          draggedFileIds = Array.from(checkedBoxes).map(cb => cb.dataset.id);
        } else {
          // 移动当前文件
          draggedFileIds = [item.dataset.id];
        }
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedFileIds.join(','));
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        draggedFileIds = [];
        document.querySelectorAll('.folder-item').forEach(f => {
          f.classList.remove('drag-over');
        });
      });
    });

    document.querySelectorAll('.folder-item[data-droppable="true"]').forEach(folder => {
      folder.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        folder.classList.add('drag-over');
      });

      folder.addEventListener('dragleave', () => {
        folder.classList.remove('drag-over');
      });

      folder.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation(); // 阻止冒泡到文件夹点击事件
        folder.classList.remove('drag-over');

        // 获取拖拽的文件ID列表
        const data = e.dataTransfer.getData('text/plain');
        const fileIds = data ? data.split(',') : draggedFileIds;

        if (fileIds.length > 0) {
          const targetFolderId = folder.dataset.id;
          try {
            // 使用批量移动API
            const res = await fetch('/files/move-batch', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fileIds: fileIds,
                folder: targetFolderId || null
              })
            });
            const result = await res.json();
            if (result.success) {
              location.reload();
            } else {
              alert(result.message || '移动失败');
            }
          } catch (error) {
            console.error('Move error:', error);
            alert('移动失败');
          }
        }
      });
    });

    // 文件夹点击事件 - 只在非拖拽状态下导航
    document.querySelectorAll('.folder-item[data-type="folder"]').forEach(folder => {
      folder.addEventListener('click', (e) => {
        // 如果正在拖拽，不执行导航
        if (document.querySelector('.file-item.dragging')) return;
        const folderId = folder.dataset.id;
        this.navigateToFolder(folderId);
      });
    });

      }

  // Modals
  initModals() {
    // Close button handlers
    document.getElementById('closeMoveModal')?.addEventListener('click', () => this.hideMoveModal());
    document.getElementById('cancelMoveBtn')?.addEventListener('click', () => this.hideMoveModal());
    document.getElementById('confirmMoveBtn')?.addEventListener('click', () => this.confirmMove());

    document.getElementById('closeRenameModal')?.addEventListener('click', () => this.hideRenameModal());
    document.getElementById('cancelRenameBtn')?.addEventListener('click', () => this.hideRenameModal());
    document.getElementById('confirmRenameBtn')?.addEventListener('click', () => this.confirmRename());

    document.getElementById('closeShareModal')?.addEventListener('click', () => this.hideShareModal());
    document.getElementById('cancelShareBtn')?.addEventListener('click', () => this.hideShareModal());
    document.getElementById('createShareBtn')?.addEventListener('click', () => this.createShare());

    // Click outside to close
    ['moveModal', 'renameModal', 'shareModal'].forEach(id => {
      const modal = document.getElementById(id);
      modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('show');
        }
      });
    });

    // Load folder tree
    this.loadFolderTree();
  }

  selectFolderItem(item) {
    document.querySelectorAll('#folderTree .folder-item').forEach(f => f.classList.remove('selected'));
    item.classList.add('selected');
    this.selectedFolderItem = item;
  }

  async loadFolderTree() {
    try {
      // 读取所有 cookie
      const cookies = document.cookie;
      console.log('All cookies:', cookies);

      // 直接用 fetch 发送 same-origin 请求，Cookie 会自动发送
      const res = await fetch('/folders', {
        headers: {
          'Accept': 'application/json'
        }
      });
      const folders = await res.json();
      console.log('Folders API response:', folders);

      const treeContainer = document.getElementById('folderTree');
      if (!treeContainer || !folders || !folders.data) {
        console.log('Skip: missing container or folders');
        return;
      }

      console.log('Building tree with', folders.data.length, 'folders');

      // Clear existing items except root
      treeContainer.innerHTML = `
        <div class="folder-item root selected" data-id="" data-selectable="true">
          <span class="folder-icon">&#128193;</span>
          <span class="folder-name">全部文件</span>
        </div>
      `;

      // Add folders as tree structure
      // Build tree structure
      const folderMap = {};
      const rootFolders = [];

      folders.data.forEach(folder => {
        folderMap[folder._id] = { ...folder, children: [] };
        console.log('  Added to map:', folder.name, 'parent:', folder.parent);
      });

      folders.data.forEach(folder => {
        if (folder.parent) {
          const parent = folderMap[folder.parent];
          if (parent) {
            parent.children.push(folderMap[folder._id]);
          } else {
            rootFolders.push(folderMap[folder._id]);
          }
        } else {
          rootFolders.push(folderMap[folder._id]);
        }
      });

      // Render tree recursively
      const renderNode = (node) => {
        const item = document.createElement('div');
        item.className = 'folder-item child';
        item.dataset.id = node._id;
        item.dataset.selectable = 'true';
        item.style.setProperty('padding-left', `${32 + (node.depth || 0) * 20}px`, 'important');
        item.innerHTML = `
          <span class="folder-icon">&#128194;</span>
          <span class="folder-name">${node.name}</span>
        `;
        return item;
      };

      const renderTree = (nodes, container) => {
        nodes.forEach(node => {
          const item = renderNode(node);
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectFolderItem(item);
          });
          container.appendChild(item);
          if (node.children?.length > 0) {
            renderTree(node.children, container);
          }
        });
      };

      renderTree(rootFolders, treeContainer);
      console.log('Tree rendered, total items:', treeContainer.querySelectorAll('.folder-item').length);

      // Add click handler for root
      const rootItem = treeContainer.querySelector('.folder-item.root');
      rootItem?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectFolderItem(rootItem);
      });

      treeContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.folder-item');
        if (item && item.dataset.selectable) {
          e.stopPropagation();
          this.selectFolderItem(item);
        }
      });

    } catch (error) {
      console.error('Load folder tree error:', error);
    }
  }

  showMoveModal() {
    document.getElementById('moveModal')?.classList.add('show');
  }

  hideMoveModal() {
    document.getElementById('moveModal')?.classList.remove('show');
  }

  async confirmMove() {
    const selectedFolder = document.querySelector('.folder-item.selected');
    const targetFolderId = selectedFolder?.dataset.id || '';

    try {
      const res = await fetch('/files/move-batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileIds: Array.from(this.selectedFiles),
          folder: targetFolderId || null
        })
      });
      const data = await res.json();

      if (data.success) {
        this.hideMoveModal();
        this.selectedFiles.clear();
        document.querySelectorAll('.file-checkbox').forEach(cb => {
          cb.checked = false;
          cb.closest('.file-item')?.classList.remove('selected');
        });
        this.updateBatchActions();
        location.reload();
      } else {
        alert(data.message || '移动失败');
      }
    } catch (error) {
      console.error('Batch move error:', error);
      alert('移动失败');
    }
  }

  showRenameModal(type, id, currentName) {
    const modal = document.getElementById('renameModal');
    const input = document.getElementById('renameInput');
    if (modal && input) {
      modal.dataset.type = type;
      modal.dataset.id = id;

      if (type === 'file') {
        currentName = getFileNameWithoutExt(currentName);
      }

      input.value = currentName;
      modal.classList.add('show');
      input.focus();
      input.select();
    }
  }

  hideRenameModal() {
    document.getElementById('renameModal')?.classList.remove('show');
  }

  async confirmRename() {
    const modal = document.getElementById('renameModal');
    const input = document.getElementById('renameInput');
    const type = modal?.dataset.type;
    const id = modal?.dataset.id;
    const newName = input?.value?.trim();

    if (!newName) {
      alert('文件名不能为空');
      return;
    }

    if (type === 'file') {
      const originalName = document.querySelector(`.file-item-row[data-id="${id}"] .file-name`)?.textContent || '';
      const ext = getFileExt(originalName);
      if (ext && getFileExt(newName) && getFileExt(newName).toLowerCase() !== ext.toLowerCase()) {
        alert('不能修改文件扩展名');
        return;
      }
    }

    try {
      let res;
      if (type === 'file') {
        res = await fetch(`/files/${id}/rename`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName })
        });
      } else {
        res = await fetch(`/folders/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName })
        });
      }

      const data = await res.json();
      if (data.success) {
        this.hideRenameModal();
        location.reload();
      } else {
        alert(data.message || '重命名失败');
      }
    } catch (error) {
      console.error('Rename error:', error);
      alert('重命名失败');
    }
  }

  showShareModal() {
    document.getElementById('shareModal')?.classList.add('show');
  }

  hideShareModal() {
    document.getElementById('shareModal')?.classList.remove('show');
    document.getElementById('shareExpire').value = '';
    document.getElementById('sharePassword').value = '';
  }

  async createShare() {
    const expire = document.getElementById('shareExpire')?.value;
    const password = document.getElementById('sharePassword')?.value;

    try {
      const res = await fetch('/share/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileIds: Array.from(this.selectedFiles),
          expiresIn: expire ? parseInt(expire) : null,
          password: password || null
        })
      });
      const data = await res.json();

      if (data.success && data.shareToken) {
        const shareUrl = `${window.location.origin}/share/${data.shareToken}`;
        prompt('分享链接已复制到剪贴板：', shareUrl);
        navigator.clipboard.writeText(shareUrl).catch(() => {});
        this.hideShareModal();
      } else {
        alert(data.message || '创建分享失败');
      }
    } catch (error) {
      console.error('Create share error:', error);
      alert('创建分享失败');
    }
  }

  initDragDrop() {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return;

    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes('Files')) {
        dropZone.classList.add('active');
      }
    });

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    document.addEventListener('dragleave', (e) => {
      if (e.target === document.documentElement || e.target === document.body) {
        dropZone.classList.remove('active');
      }
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('active');

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.uploadFiles(files);
      }
    });
  }

  initImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    const previewImg = document.getElementById('previewImg');
    const closeBtn = document.querySelector('.modal-close');
    const previewFileName = document.getElementById('previewFileName');
    const downloadBtn = document.getElementById('previewDownloadBtn');

    if (!modal) return;

    document.querySelectorAll('.file-thumb-container').forEach(container => {
      container.addEventListener('click', () => {
        const fullUrl = container.dataset.fullUrl;
        const fileId = container.closest('.file-item')?.dataset.id;
        const fileName = container.closest('.file-item')?.querySelector('.file-name')?.textContent;

        if (fullUrl && previewImg) {
          previewImg.src = fullUrl;
          previewImg.dataset.fileId = fileId;
          if (previewFileName) previewFileName.textContent = fileName || '';
          if (downloadBtn) downloadBtn.href = `/files/${fileId}/download`;
          modal.classList.add('show');
        }
      });
    });

    closeBtn?.addEventListener('click', () => {
      modal.classList.remove('show');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('show');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('show')) {
        modal.classList.remove('show');
      }
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
    this.showRenameModal('folder', folderId, currentName);
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
        this.selectedFiles.delete(fileId);
        this.updateBatchActions();
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
    const urlParams = new URLSearchParams(window.location.search);
    formData.append('folder', urlParams.get('folder') || '');

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

function getFileExt(filename) {
  const lastDot = filename.lastIndexOf('.');
  return lastDot > 0 ? filename.substring(lastDot) : '';
}

function getFileNameWithoutExt(filename) {
  const lastDot = filename.lastIndexOf('.');
  return lastDot > 0 ? filename.substring(0, lastDot) : filename;
}