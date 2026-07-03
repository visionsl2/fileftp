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
    this.initVideoPlayer();
    this.initModals();
    this.bindSearch();
    this.bindRecentFiles();
    this.initSidebar();
    this.applyViewMode();
    this.pollAiStatus();
    this.initInfiniteScroll();
  }

  // 无限滚动加载更多
  initInfiniteScroll() {
    const sentinel = document.getElementById('loadMoreSentinel');
    if (!sentinel) return;

    this._loadingMore = false;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !this._loadingMore) {
        this.loadMoreFiles();
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  }

  async loadMoreFiles() {
    const list = document.getElementById('fileList');
    if (!list) return;
    const nextPage = parseInt(list.dataset.page || '1') + 1;
    const totalPages = parseInt(list.dataset.totalPages || '1');
    if (nextPage > totalPages) return;

    this._loadingMore = true;
    const sentinel = document.getElementById('loadMoreSentinel');
    if (sentinel) sentinel.textContent = '加载中...';

    try {
      const folder = list.dataset.folder || '';
      const url = '/files/more?page=' + nextPage + (folder ? '&folder=' + folder : '');
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.html) {
        // 创建临时容器解析 HTML
        const tmp = document.createElement('div');
        tmp.innerHTML = data.html;
        while (tmp.firstChild) {
          list.appendChild(tmp.firstChild);
        }
        list.dataset.page = data.nextPage;
        if (!data.hasMore) {
          // 没有更多了，移除 sentinel 和 observer
          if (sentinel) sentinel.remove();
        } else {
          if (sentinel) sentinel.textContent = '加载更多...';
        }
        // 重新绑定事件到新元素
        this.rebindFileActions();
      }
    } catch (e) {
      console.error('Load more error:', e);
      if (sentinel) sentinel.textContent = '加载失败，点击重试';
    } finally {
      this._loadingMore = false;
    }
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

    // 智能整理按钮
    document.getElementById('aiAnalyzeBtn')?.addEventListener('click', () => {
      this.aiAnalyzeFiles();
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
      const res = await fetch('/folders', {
        headers: { 'Accept': 'application/json' }
      });
      const folders = await res.json();

      const treeContainer = document.getElementById('folderTree');
      if (!treeContainer || !folders || !folders.data) return;

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
        const copied = await this.copyToClipboard(shareUrl);
        if (copied) {
          alert('分享链接已复制到剪贴板！');
        } else {
          prompt('请手动复制分享链接：', shareUrl);
        }
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

    // 排除视频缩略图容器（视频由 initVideoPlayer 处理）
    document.querySelectorAll('.file-thumb-container:not([data-type="video"])').forEach(container => {
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

  initVideoPlayer() {
    const modal = document.getElementById('videoPlayerModal');
    const videoPlayer = document.getElementById('videoPlayer');
    const closeBtn = document.getElementById('closeVideoPlayer');
    const videoFileName = document.getElementById('videoFileName');
    const downloadBtn = document.getElementById('videoDownloadBtn');

    if (!modal || !videoPlayer) return;

    // 视频缩略图点击 → 打开播放器
    document.querySelectorAll('.file-thumb-container[data-type="video"]').forEach(container => {
      container.addEventListener('click', (e) => {
        e.stopPropagation();
        const streamUrl = container.dataset.fullUrl;
        const fileItem = container.closest('.file-item');
        const fileId = fileItem?.dataset.id;
        const fileName = fileItem?.querySelector('.file-name')?.textContent;

        if (streamUrl) {
          videoPlayer.src = streamUrl;
          if (videoFileName) videoFileName.textContent = fileName || '';
          if (downloadBtn) downloadBtn.href = '/files/' + fileId + '/download';
          modal.classList.add('show');
          videoPlayer.play().catch(() => {});
        }
      });
    });

    // 关闭按钮
    closeBtn?.addEventListener('click', () => {
      videoPlayer.pause();
      videoPlayer.src = '';
      modal.classList.remove('show');
    });

    // 点击背景关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        videoPlayer.pause();
        videoPlayer.src = '';
        modal.classList.remove('show');
      }
    });

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('show')) {
        videoPlayer.pause();
        videoPlayer.src = '';
        modal.classList.remove('show');
      }
    });
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 降级方案：非 HTTPS 环境或权限不足时使用 execCommand
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
      } catch {
        return false;
      }
    }
  }

  // --- 搜索 ---
  bindSearch() {
    const input = document.getElementById('searchInput');
    const clear = document.getElementById('searchClear');
    if (!input) return;
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const val = input.value.trim();
      clear.style.display = val ? 'block' : 'none';
      timer = setTimeout(() => this.doSearch(val), 300);
    });
    clear.addEventListener('click', () => {
      input.value = '';
      clear.style.display = 'none';
      this.doSearch('');
    });
  }

  async doSearch(keyword) {
    const fileList = document.getElementById('fileList');
    if (!fileList) return;
    if (!keyword) {
      if (this._originalList) { fileList.innerHTML = this._originalList; this._originalList = null; this.rebindFileActions(); }
      return;
    }
    if (!this._originalList) this._originalList = fileList.innerHTML;
    try {
      const res = await fetch('/files/search?q=' + encodeURIComponent(keyword));
      const data = await res.json();
      if (!data.files || data.files.length === 0) {
        fileList.innerHTML = '<div class="empty-state"><p>未找到匹配文件</p></div>';
        return;
      }
      let html = '';
      data.files.forEach(f => {
        const thumbHtml = (f.isImage || (f.isVideo && f.thumb))
          ? '<div class="file-thumb-container" data-type="' + (f.isVideo ? 'video' : 'image') + '" data-full-url="/files/' + f.id + '/' + (f.isVideo ? 'stream' : 'preview') + '"><img src="/files/' + f.id + '/thumb" class="file-thumb" loading="lazy">' + (f.isVideo ? '<div class="video-play-overlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>' : '') + '</div>'
          : '<div class="file-icon"><svg viewBox="0 0 24 24"><path d="M6 2c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6H6z"/></svg></div>';
        const folderLink = f.folderPath
          ? ' <a href="/files?folder=' + f.folderId + '" class="search-result-folder">📁 ' + f.folderPath + '</a>'
          : '';
        const aiTag = f.aiCategory
          ? '<span class="ai-category-badge">' + f.aiCategory + '</span> '
          : '';
        html += '<div class="file-item file-item-row" data-type="file" data-id="' + f.id + '" draggable="true">' +
          '<input type="checkbox" class="file-checkbox" data-id="' + f.id + '">' + thumbHtml +
          '<div class="file-name">' + f.name + '</div>' +
          '<div class="file-ai-info">' + aiTag + folderLink + '</div>' +
          '<div class="file-size">' + formatSize(f.size) + '</div>' +
          '<div class="file-actions"><a href="/files/' + f.id + '/download" class="action-btn download"><svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></a></div></div>';
      });
      fileList.innerHTML = html;
      this.rebindFileActions();
    } catch (e) { console.error('Search error:', e); }
  }

  rebindFileActions() {
    this.initImagePreview();
    this.initVideoPlayer();
    this.bindSelectionEvents();
    this.bindDragMove();
  }

  // --- 最近上传点击 ---
  bindRecentFiles() {
    document.querySelectorAll('.recent-item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.dataset.type, url = item.dataset.url;
        const fileId = item.dataset.id, folder = item.dataset.folder;
        const name = item.querySelector('.recent-name')?.textContent || '';
        if (type === 'image') {
          const m = document.getElementById('imagePreviewModal');
          const i = document.getElementById('previewImg');
          const n = document.getElementById('previewFileName');
          const d = document.getElementById('previewDownloadBtn');
          if (m && i) { i.src = url; if (n) n.textContent = name; if (d) d.href = '/files/' + fileId + '/download'; m.classList.add('show'); }
        } else if (type === 'video') {
          const m = document.getElementById('videoPlayerModal');
          const p = document.getElementById('videoPlayer');
          const n = document.getElementById('videoFileName');
          const d = document.getElementById('videoDownloadBtn');
          if (m && p) { p.src = url; if (n) n.textContent = name; if (d) d.href = '/files/' + fileId + '/download'; m.classList.add('show'); p.play().catch(() => {}); }
        } else if (folder) {
          window.location.href = '/files?folder=' + folder;
        }
      });
    });
  }

  // --- 侧边栏 ---
  initSidebar() {
    this.loadSidebarTree();
    // 折叠按钮
    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('collapsed');
    });
  }

  async loadSidebarTree() {
    try {
      const res = await fetch('/folders', { headers: { 'Accept': 'application/json' } });
      const folders = await res.json();
      const tree = document.getElementById('sidebarTree');
      if (!tree || !folders || !folders.data) return;

      // 清空并重建
      tree.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'folder-item root';
      root.dataset.id = '';
      root.innerHTML = '<span class="folder-icon">📂</span><span class="folder-name">全部文件</span>';
      root.addEventListener('click', () => this.navigateToFolder(''));
      if (!this.currentFolder) root.classList.add('selected');
      tree.appendChild(root);

      // 构建树
      const folderMap = {};
      const rootFolders = [];
      folders.data.forEach(f => {
        folderMap[f._id] = { ...f, children: [] };
      });
      folders.data.forEach(f => {
        if (f.parent && folderMap[f.parent]) {
          folderMap[f.parent].children.push(folderMap[f._id]);
        } else {
          rootFolders.push(folderMap[f._id]);
        }
      });

      const renderNode = (node, depth) => {
        const item = document.createElement('div');
        item.className = 'folder-item child';
        item.dataset.id = node._id;
        item.style.paddingLeft = (14 + depth * 16) + 'px';
        item.innerHTML = '<span class="folder-icon">📁</span><span class="folder-name">' + node.name + '</span>';
        item.addEventListener('click', (e) => { e.stopPropagation(); this.navigateToFolder(node._id); });
        if (node._id === this.currentFolder) item.classList.add('selected');
        tree.appendChild(item);
        if (node.children?.length > 0) {
          node.children.forEach(c => renderNode(c, depth + 1));
        }
      };
      rootFolders.forEach(n => renderNode(n, 1));
    } catch (e) {
      console.error('Sidebar tree error:', e);
    }
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

  async aiAnalyzeFiles() {
    const btn = document.getElementById('aiAnalyzeBtn');
    btn.disabled = true;
    btn.textContent = '分析中...';
    try {
      const body = {};
      if (this.selectedFiles.size > 0) {
        body.fileIds = Array.from(this.selectedFiles);
      } else {
        body.folder = this.currentFolder || null;
      }
      const res = await fetch('/files/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || '分析完成');
        location.reload();
      } else if (res.status === 429) {
        alert('本月 AI 配额已用完，请下月再试或联系管理员');
      } else {
        alert(data.message || '分析失败');
      }
    } catch (e) {
      console.error('AI analyze error:', e);
      alert('分析请求失败');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>智能整理';
    }
  }

  // 轮询 AI 分析状态，更新 pending 文件卡片
  async pollAiStatus() {
    const pendingItems = document.querySelectorAll('.file-item-row[data-ai-pending="true"]');
    if (pendingItems.length === 0) return;

    const checkOne = async (item) => {
      const fileId = item.dataset.id;
      try {
        const res = await fetch('/files/' + fileId + '/ai-status');
        const data = await res.json();
        if (data.status === 'done') {
          item.dataset.aiPending = 'false';
          const aiInfo = item.querySelector('.file-ai-info');
          if (aiInfo && data.result) {
            const badge = document.createElement('span');
            badge.className = 'ai-category-badge';
            badge.title = '置信度 ' + (data.result.confidence || 0) + '%';
            badge.textContent = data.result.category || '';
            const summary = document.createElement('span');
            summary.className = 'ai-summary';
            summary.textContent = data.result.summary || '';
            aiInfo.innerHTML = '';
            aiInfo.appendChild(badge);
            if (data.result.summary) aiInfo.appendChild(summary);
          }
        }
      } catch (e) { /* retry next poll */ }
    };

    await Promise.all([...pendingItems].map(checkOne));

    const remaining = document.querySelectorAll('.file-item-row[data-ai-pending="true"]').length;
    if (remaining > 0) {
      setTimeout(() => this.pollAiStatus(), 3000);
    }
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

    const urlParams = new URLSearchParams(window.location.search);
    const folderId = urlParams.get('folder') || '';

    // 逐个文件顺序上传（避免大视频打包进单个 FormData 导致内存爆炸）
    let successCount = 0, failCount = 0, _lastUploadData = null;
    const results = [];

    const container = document.createElement('div');
    container.className = 'upload-batch';
    container.innerHTML = '<div class="upload-batch-title">上传 ' + files.length + ' 个文件</div>';
    uploadList?.appendChild(container);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileItem = document.createElement('div');
      fileItem.className = 'upload-file-item';
      fileItem.innerHTML =
        '<span class="upload-file-name">' + file.name + '</span>' +
        '<span class="upload-file-size">' + formatSize(file.size) + '</span>' +
        '<span class="upload-file-status">等待...</span>' +
        '<div class="upload-progress" style="height:3px"><div class="upload-progress-bar" style="width:0%"></div></div>';
      container.appendChild(fileItem);

      const bar = fileItem.querySelector('.upload-progress-bar');
      const status = fileItem.querySelector('.upload-file-status');

      try {
        const data = _lastUploadData = await this.uploadSingleFile(file, folderId, (pct) => {
          if (bar) bar.style.width = pct + '%';
          if (status) status.textContent = pct + '%';
        });
        if (data && data.success) {
          successCount++;
          if (status) { status.textContent = '✓'; status.className = 'upload-file-status success'; }
          if (data.files) results.push(...data.files);
        } else {
          failCount++;
          if (status) { status.textContent = '✗ ' + ((data && data.message) || '失败'); status.className = 'upload-file-status error'; }
        }
      } catch (e) {
        failCount++;
        if (status) { status.textContent = '✗ 网络错误'; status.className = 'upload-file-status error'; }
      }
    }

    const summary = document.createElement('div');
    summary.className = 'upload-batch-summary';
    let summaryHTML = '完成: ' + successCount + ' 成功' + (failCount > 0 ? ', ' + failCount + ' 失败' : '');
    if (results.length > 0) {
      summaryHTML += '<div class="upload-results">';
      results.forEach(f => {
        const dest = f.category ? '<span class="ai-tag">' + f.category + '</span> ' + (f.folderPath || '根目录') : '根目录';
        const link = f.folderId ? ' <a href="/files?folder=' + f.folderId + '" class="upload-goto">📂 ' + dest + '</a>' : ' <span class="upload-goto">📂 ' + dest + '</span>';
        summaryHTML += '<div class="upload-result-item"><span class="upload-filename">' + f.name + '</span>' + link + '</div>';
      });
      // 如果后台正在 AI 分析，在摘要底部显示提示 + 自动刷新
      if (_lastUploadData && _lastUploadData.aiPending && _lastUploadData.aiPending.length > 0) {
        summaryHTML += '<div class="upload-result-item" style="color:#f0ad4e;font-size:12px">🏷 文件已保存，AI正在后台分析中...3秒后自动刷新</div>';
      }
      summaryHTML += '</div>';
    }
    summary.innerHTML = summaryHTML;
    container.appendChild(summary);

    // 上传到当前目录时，自动刷新页面以显示新文件和 AI 徽标
    if (successCount > 0 && _lastUploadData && _lastUploadData.aiPending && _lastUploadData.aiPending.length > 0) {
      setTimeout(() => this.refresh(), 3000);
    }
  }

  uploadSingleFile(file, folderId, onProgress) {
    return new Promise((resolve) => {
      const fd = new FormData();
      fd.append('folder', folderId);
      fd.append('files', file);

      const xhr = new XMLHttpRequest();
      xhr.timeout = 120 * 60 * 1000;
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
      });
      xhr.addEventListener('load', () => {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ success: false, message: '解析失败' }); }
      });
      xhr.addEventListener('error', () => resolve({ success: false, message: '网络错误' }));
      xhr.addEventListener('timeout', () => resolve({ success: false, message: '上传超时' }));
      xhr.addEventListener('abort', () => resolve({ success: false, message: '已取消' }));

      xhr.open('POST', '/files/upload');
      xhr.setRequestHeader('Accept', 'application/json');
      const token = getCookie('token');
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.send(fd);
    });
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