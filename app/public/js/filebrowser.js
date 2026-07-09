document.addEventListener('DOMContentLoaded', () => {
  // 文件浏览器页（有 #fileList）→ 完整 FileBrowser
  // 总览页（只有 #galleryGrid，无 #fileList）→ 只初始化预览/视频/lightbox
  if (document.getElementById('fileList')) {
    const fileBrowser = new FileBrowser();
    window.fileBrowser = fileBrowser;
  } else if (document.getElementById('galleryGrid')) {
    initGalleryPage();
  }
});

// 总览页轻量初始化：复用完整图片预览 + 视频播放器 + lightbox
function initGalleryPage() {
  const gb = new GalleryBrowser();
  window.galleryBrowser = gb;
}

// 借用 FileBrowser 的 initImagePreview / initVideoPlayer（内部已支持 #galleryGrid）
class GalleryBrowser {
  constructor() {
    // 复用 FileBrowser 原型上的方法
    this.initImagePreview = FileBrowser.prototype.initImagePreview;
    this.initVideoPlayer = FileBrowser.prototype.initVideoPlayer;
    this.initImagePreview();
    this.initVideoPlayer();
    window.__lightbox = new Lightbox();
  }
}

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
    // 全局 Lightbox 实例（供图片预览和将来其他场景复用）
    window.__lightbox = new Lightbox();
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
        // 委托事件无需重新绑定（事件已绑在 fileList 上）
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
    // 事件委托到 fileList 容器
    const fileList = document.getElementById('fileList');
    if (!fileList || fileList._folderEventsBound) return;
    fileList._folderEventsBound = true;

    fileList.addEventListener('click', (e) => {
      const renameBtn = e.target.closest('.rename-folder');
      if (renameBtn) {
        e.stopPropagation();
        this.showRenameModal('folder', renameBtn.dataset.id,
          renameBtn.closest('.folder-item').querySelector('.file-name')?.textContent || '');
        return;
      }
      const deleteBtn = e.target.closest('.delete-folder');
      if (deleteBtn) {
        e.stopPropagation();
        this.deleteFolder(deleteBtn.dataset.id);
        return;
      }
      const folder = e.target.closest('.folder-item[data-type="folder"]');
      if (folder && !e.target.closest('.action-btn')) {
        this.navigateToFolder(folder.dataset.id);
      }
    });
  }

  bindFileEvents() {
    // 事件委托到 fileList 容器
    const fileList = document.getElementById('fileList');
    if (!fileList || fileList._fileEventsBound) return;
    fileList._fileEventsBound = true;

    fileList.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.delete-file');
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        this.deleteFile(deleteBtn.dataset.id);
      }
    });

    fileList.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.file-item-row[data-type="file"]');
      if (!item) return;
      e.preventDefault();
      const fileName = item.querySelector('.file-name')?.textContent || '';
      this.showRenameModal('file', item.dataset.id, fileName);
    });

    // contextmenu 已委托到 fileList（见上方）
  }

  bindRefreshEvent() {
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
      this.refresh();
    });
  }

  // Selection handling — 事件委托到 #fileList，只绑一次
  bindSelectionEvents() {
    const fileList = document.getElementById('fileList');
    if (!fileList || fileList._selectionBound) return;
    fileList._selectionBound = true;

    fileList.addEventListener('change', (e) => {
      const checkbox = e.target.closest('.file-checkbox');
      if (!checkbox) return;
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

  // Drag to move files — 事件委托
  bindDragMove() {
    const fileList = document.getElementById('fileList');
    if (!fileList || fileList._dragBound) return;
    fileList._dragBound = true;

    let draggedFileIds = [];

    // 拖拽开始（委托到 fileList）
    fileList.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.file-item-row[draggable="true"]');
      if (!item) return;
      const checkedBoxes = document.querySelectorAll('.file-checkbox:checked');
      if (checkedBoxes.length > 0) {
        draggedFileIds = Array.from(checkedBoxes).map(cb => cb.dataset.id);
      } else {
        draggedFileIds = [item.dataset.id];
      }
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedFileIds.join(','));
    });

    // 拖拽结束
    fileList.addEventListener('dragend', (e) => {
      const item = e.target.closest('.file-item-row');
      if (!item) return;
      item.classList.remove('dragging');
      draggedFileIds = [];
      document.querySelectorAll('.folder-item').forEach(f => {
        f.classList.remove('drag-over');
      });
    });

    // 文件夹拖入 — 委托到 fileList 容器（包含 sidebarTree 和 folderTree）
    const dropContainers = [document.getElementById('sidebarTree'), document.getElementById('folderTree')];
    dropContainers.forEach(container => {
      if (!container || container._dropBound) return;
      container._dropBound = true;

      container.addEventListener('dragover', (e) => {
        const folder = e.target.closest('.folder-item[data-droppable="true"]');
        if (!folder) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        folder.classList.add('drag-over');
      });

      container.addEventListener('dragleave', (e) => {
        const folder = e.target.closest('.folder-item');
        if (folder) folder.classList.remove('drag-over');
      });

      container.addEventListener('drop', async (e) => {
        const folder = e.target.closest('.folder-item[data-droppable="true"]');
        if (!folder) return;
        e.preventDefault();
        e.stopPropagation();
        folder.classList.remove('drag-over');

        const data = e.dataTransfer.getData('text/plain');
        const fileIds = data ? data.split(',') : draggedFileIds;
        if (fileIds.length === 0) return;

        const targetFolderId = folder.dataset.id;
        try {
          const res = await fetch('/files/move-batch', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileIds, folder: targetFolderId || null })
          });
          const result = await res.json();
          if (result.success) location.reload();
          else alert(result.message || '移动失败');
        } catch (err) {
          console.error('Move error:', err);
          alert('移动失败');
        }
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

    // 移动弹窗的文件夹树复用 sidebar 树（避免重复 fetch /folders）
    // 委托到 #folderTree 单次绑定 + 重用同一份数据缓存
    this.initMoveModalTree();
  }

  initMoveModalTree() {
    const tree = document.getElementById('folderTree');
    if (!tree || tree._bound) return;
    tree._bound = true;

    // 委托：点击文件夹选中
    tree.addEventListener('click', (e) => {
      const item = e.target.closest('.folder-item');
      if (item && item.dataset.selectable !== undefined) {
        document.querySelectorAll('#folderTree .folder-item').forEach(f => f.classList.remove('selected'));
        item.classList.add('selected');
        this.selectedFolderItem = item;
      }
    });
  }

  selectFolderItem(item) {
    document.querySelectorAll('#folderTree .folder-item').forEach(f => f.classList.remove('selected'));
    item.classList.add('selected');
    this.selectedFolderItem = item;
  }

  /**
   * 用缓存的数据填充文件夹树（避免重复请求 /folders）
   * 第一次调用时 fetch，后续调用直接用 _cachedFolders
   */
  async ensureFolderTreeData() {
    if (this._cachedFolders) return this._cachedFolders;
    const res = await fetch('/folders', { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    this._cachedFolders = data.data || [];
    return this._cachedFolders;
  }

  async populateFolderTree() {
    const tree = document.getElementById('folderTree');
    if (!tree) return;
    const folders = await this.ensureFolderTreeData();
    if (!folders) return;

    tree.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'folder-item root selected';
    root.dataset.id = '';
    root.dataset.selectable = 'true';
    root.innerHTML = '<span class="folder-icon">📁</span><span class="folder-name">全部文件</span>';
    tree.appendChild(root);

    // 构建树结构
    const folderMap = {};
    const rootFolders = [];
    folders.forEach(f => { folderMap[f._id] = { ...f, children: [] }; });
    folders.forEach(f => {
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
      item.dataset.selectable = 'true';
      item.style.paddingLeft = (14 + depth * 16) + 'px';
      item.innerHTML = '<span class="folder-icon">📂</span><span class="folder-name">' + node.name + '</span>';
      tree.appendChild(item);
      if (node.children?.length > 0) {
        node.children.forEach(c => renderNode(c, depth + 1));
      }
    };
    rootFolders.forEach(n => renderNode(n, 1));
  }

  showMoveModal() {
    this.populateFolderTree();
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
    const closeBtn = document.getElementById('imagePreviewModal')?.querySelector('.modal-close');

    if (!modal) return;

    // 委托：缩略图点击 → 打开完整预览
    // 支持两个容器：文件浏览器(#fileList) 和 总览页(#galleryGrid)
    const containers = [
      document.getElementById('fileList'),
      document.getElementById('galleryGrid')
    ].filter(Boolean);
    containers.forEach((container) => {
      if (container._imagePreviewBound) return;
      container.addEventListener('click', (e) => {
        // 总览页：.gallery-thumb（非视频）；文件浏览器：.file-thumb-container（非视频）
        const galleryThumb = e.target.closest('.gallery-thumb:not([data-is-video="true"])');
        if (galleryThumb && container.id === 'galleryGrid') {
          if (galleryThumb.classList.contains('gallery-thumb-placeholder')) return;
          const fileId = galleryThumb.dataset.fileId;
          if (fileId) openPreview(fileId);
          return;
        }
        const fileContainer = e.target.closest('.file-thumb-container:not([data-type="video"])');
        if (fileContainer) {
          const fileItem = fileContainer.closest('.file-item');
          const fileId = fileItem?.dataset.id;
          if (fileId) openPreview(fileId);
        }
      });
      container._imagePreviewBound = true;
    });

    // 单次绑定关闭按钮
    if (!modal._closeBound) {
      closeBtn?.addEventListener('click', () => closePreview());
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closePreview();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('show')) closePreview();
      });

      // 全屏按钮
      const fsBtn = document.getElementById('previewFullscreenBtn');
      fsBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (previewImg && previewImg.src) {
          window.__lightbox?.open(previewImg.src);
        }
      });

      // AI 字段自动保存（失焦或 change）
      const catSelect = document.getElementById('previewCategorySelect');
      catSelect?.addEventListener('change', () => saveAiAnalysis({ category: catSelect.value }));

      const summaryInput = document.getElementById('previewSummaryInput');
      summaryInput?.addEventListener('blur', () => {
        const current = modal._previewData?.aiAnalysis?.summary || '';
        if (summaryInput.value !== current) {
          saveAiAnalysis({ summary: summaryInput.value });
        }
      });
      summaryInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); summaryInput.blur(); }
      });

      // 标签添加
      const tagAddBtn = document.getElementById('previewTagAddBtn');
      const tagInput = document.getElementById('previewTagInput');
      const addTag = () => {
        const val = tagInput?.value?.trim();
        if (!val || !modal._previewData) return;
        const labels = (modal._previewData.aiAnalysis?.labels || []).slice();
        if (!labels.includes(val) && labels.length < 20) {
          labels.push(val);
          saveAiAnalysis({ labels });
        }
        if (tagInput) tagInput.value = '';
      };
      tagAddBtn?.addEventListener('click', addTag);
      tagInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addTag(); }
      });

      // 标签删除（委托）
      const tagsEl = document.getElementById('previewTags');
      tagsEl?.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.preview-tag-remove');
        if (!removeBtn) return;
        const idx = parseInt(removeBtn.dataset.idx, 10);
        if (isNaN(idx)) return;
        const labels = (modal._previewData?.aiAnalysis?.labels || []).slice();
        labels.splice(idx, 1);
        saveAiAnalysis({ labels });
      });

      // 删除按钮
      const deleteBtn = document.getElementById('previewDeleteBtn');
      deleteBtn?.addEventListener('click', () => deleteCurrentFile());

      // 路径编辑按钮
      const folderEditBtn = document.getElementById('previewFolderEditBtn');
      folderEditBtn?.addEventListener('click', () => openFolderPicker());

      // 文件夹选择器弹窗
      const picker = document.getElementById('previewFolderPicker');
      document.getElementById('closePreviewFolderPicker')?.addEventListener('click', closeFolderPicker);
      document.getElementById('cancelPreviewFolderBtn')?.addEventListener('click', closeFolderPicker);
      document.getElementById('confirmPreviewFolderBtn')?.addEventListener('click', confirmFolderChange);
      picker?.addEventListener('click', (e) => { if (e.target === picker) closeFolderPicker(); });

      // AI 重新分析
      const reanBtn = document.getElementById('previewReanalyzeBtn');
      reanBtn?.addEventListener('click', () => reanalyzeCurrentFile());

      modal._closeBound = true;
    }
  }

  initVideoPlayer() {
    const modal = document.getElementById('videoPlayerModal');
    const videoPlayer = document.getElementById('videoPlayer');
    const closeBtn = document.getElementById('closeVideoPlayer');

    if (!modal || !videoPlayer) return;

    // 事件委托：视频缩略图点击统一处理
    // 支持两个容器：文件浏览器(#fileList) 和 总览页(#galleryGrid)
    const containers = [
      document.getElementById('fileList'),
      document.getElementById('galleryGrid')
    ].filter(Boolean);
    containers.forEach((container) => {
      if (container._videoPlayerBound) return;
      container.addEventListener('click', (e) => {
        // 总览页视频缩略图或播放按钮
        const galleryThumb = e.target.closest('.gallery-thumb[data-is-video="true"], .gallery-video-play');
        if (galleryThumb && container.id === 'galleryGrid') {
          e.stopPropagation();
          openVideoPlayer(
            galleryThumb.dataset.fullUrl,
            galleryThumb.dataset.fileId,
            galleryThumb.dataset.fileName
          );
          return;
        }
        // 文件浏览器视频缩略图
        const fileContainer = e.target.closest('.file-thumb-container[data-type="video"]');
        if (fileContainer) {
          e.stopPropagation();
          const fileItem = fileContainer.closest('.file-item');
          openVideoPlayer(
            fileContainer.dataset.fullUrl,
            fileItem?.dataset.id,
            fileItem?.querySelector('.file-name')?.textContent
          );
        }
      });
      container._videoPlayerBound = true;
    });

    if (!modal._closeBound) {
      closeBtn?.addEventListener('click', () => {
        videoPlayer.pause();
        videoPlayer.src = '';
        modal.classList.remove('show');
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          videoPlayer.pause();
          videoPlayer.src = '';
          modal.classList.remove('show');
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('show')) {
          videoPlayer.pause();
          videoPlayer.src = '';
          modal.classList.remove('show');
        }
      });
      modal._closeBound = true;
    }
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
      if (this._originalList) { fileList.innerHTML = this._originalList; this._originalList = null; }
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
    } catch (e) { console.error('Search error:', e); }
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
    this.initFolderContextMenu();
    this.initMergeFolder();
  }

  initFolderContextMenu() {
    const tree = document.getElementById('sidebarTree');
    const menu = document.getElementById('folderContextMenu');
    if (!tree || !menu || tree._ctxBound) return;
    tree._ctxBound = true;
    tree.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.folder-item');
      if (!item) return;
      const folderId = item.dataset.id;
      if (!folderId) return;
      e.preventDefault();
      this._ctxTargetId = folderId;
      this._ctxTargetName = item.querySelector('.folder-name')?.textContent || '';
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      menu.style.display = 'block';
      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (e.clientX - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (e.clientY - rect.height) + 'px';
      });
    });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;
      const action = item.dataset.action;
      console.log('[ctx click]', action);
      const targetId = this._ctxTargetId;
      const targetName = this._ctxTargetName;
      menu.style.display = 'none';
      if (action === 'rename' && targetId) this.showRenameModal('folder', targetId, targetName);
      else if (action === 'delete' && targetId) this.deleteFolder(targetId);
      else if (action === 'merge' && targetId) this.openMergeFolderModal(targetId, targetName);
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) menu.style.display = 'none';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.style.display !== 'none') menu.style.display = 'none';
    });
  }

  initMergeFolder() {
    const modal = document.getElementById('mergeFolderModal');
    if (!modal) return;
    document.getElementById('closeMergeFolderModal')?.addEventListener('click', () => this.closeMergeFolderModal());
    document.getElementById('cancelMergeFolderBtn')?.addEventListener('click', () => this.closeMergeFolderModal());
    document.getElementById('confirmMergeFolderBtn')?.addEventListener('click', () => this.confirmMergeFolder());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeMergeFolderModal();
    });
  }

  async openMergeFolderModal(sourceId, sourceName) {
    console.log('[merge] called', sourceId, sourceName);
    const modal = document.getElementById('mergeFolderModal');
    if (!modal) return;
    this._mergeSourceId = sourceId;
    this._mergeSourceName = sourceName;
    this._mergeTargetId = null;
    document.getElementById('mergeFolderTitle').textContent = '把 "' + sourceName + '" 合并到：';
    document.getElementById('mergeInfo').innerHTML = '<strong>提示</strong>：所有文件将移到目标文件夹，源文件夹会被删除。';
    document.getElementById('mergeTargetList').innerHTML = '<div class="merge-loading">加载中...</div>';
    document.getElementById('confirmMergeFolderBtn').disabled = true;
    modal.classList.add('show');
    try {
      const res = await fetch('/folders', { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      const folders = (data.data || []).filter(f => f._id !== sourceId && !f.isDeleted);
      if (folders.length === 0) {
        document.getElementById('mergeTargetList').innerHTML = '<div class="merge-empty">没有可选目标文件夹</div>';
        return;
      }
      const list = document.getElementById('mergeTargetList');
      list.innerHTML = '';
      folders.forEach(f => {
        const item = document.createElement('div');
        item.className = 'merge-target-item';
        item.dataset.id = f._id;
        // 根级目录 path 是 "/"（无意义），显示 name；其他显示完整路径
        const isRoot = !f.parent || f.depth === 0;
        const label = isRoot ? '/' + f.name : '/' + (f.path || f.name);
        item.innerHTML = '<span class="merge-target-radio"></span>' +
          '<span class="merge-target-icon">📁</span>' +
          '<span class="merge-target-path">' + label + '</span>';
        item.addEventListener('click', () => {
          list.querySelectorAll('.merge-target-item').forEach(x => x.classList.remove('selected'));
          item.classList.add('selected');
          this._mergeTargetId = f._id;
          document.getElementById('confirmMergeFolderBtn').disabled = false;
        });
        list.appendChild(item);
      });
    } catch (err) {
      console.error('Load folders error:', err);
      document.getElementById('mergeTargetList').innerHTML = '<div class="merge-empty">加载失败</div>';
    }
  }

  closeMergeFolderModal() {
    const modal = document.getElementById('mergeFolderModal');
    if (modal) modal.classList.remove('show');
    this._mergeSourceId = null;
    this._mergeTargetId = null;
  }

  async confirmMergeFolder() {
    const sourceId = this._mergeSourceId;
    const targetId = this._mergeTargetId;
    if (!sourceId || !targetId) return;
    if (sourceId === targetId) { alert('源和目标不能相同'); return; }
    const btn = document.getElementById('confirmMergeFolderBtn');
    btn.disabled = true;
    btn.textContent = '合并中...';
    try {
      const res = await fetch('/folders/' + sourceId + '/merge-into', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetFolderId: targetId })
      });
      const data = await res.json();
      if (data.success) {
        this.closeMergeFolderModal();
        this.loadSidebarTree();
        this.refresh();
        alert('合并成功！移动了 ' + data.movedFiles + ' 个文件，删除了源文件夹 "' + data.deletedFolder + '"');
      } else {
        alert('合并失败：' + (data.message || ''));
        btn.disabled = false;
        btn.textContent = '确定';
      }
    } catch (e) {
      console.error('confirmMergeFolder error:', e);
      alert('合并失败');
      btn.disabled = false;
      btn.textContent = '确定';
    }
  }

  async loadSidebarTree() {
    try {
      const tree = document.getElementById('sidebarTree');
      if (!tree) return;
      // 委托点击：单次绑定
      if (!tree._sidebarClickBound) {
        tree._sidebarClickBound = true;
        tree.addEventListener('click', (e) => {
          const item = e.target.closest('.folder-item');
          if (!item) return;
          const id = item.dataset.id;
          if (id !== undefined && !e.target.closest('.action-btn')) {
            this.navigateToFolder(id);
          }
        });
      }
      // 复用 /folders 缓存（避免重复请求）
      const folders = await this.ensureFolderTreeData();
      if (!folders) return;

      // 清空并重建
      tree.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'folder-item root';
      root.dataset.id = '';
      root.innerHTML = '<span class="folder-icon">📂</span><span class="folder-name">全部文件</span>';
      if (!this.currentFolder) root.classList.add('selected');
      tree.appendChild(root);

      // 构建树
      const folderMap = {};
      const rootFolders = [];
      folders.forEach(f => { folderMap[f._id] = { ...f, children: [] }; });
      folders.forEach(f => {
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
  // 错开并发：每个文件间隔 150ms 启动请求，避免瞬间冲击后端
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

    // 错开请求：每个间隔 150ms 启动一次
    const items = [...pendingItems];
    items.forEach((item, i) => {
      setTimeout(() => checkOne(item), i * 150);
    });

    // 等待所有请求完成后再判断是否继续轮询
    const totalWait = items.length * 150 + 2000;
    setTimeout(() => {
      const remaining = document.querySelectorAll('.file-item-row[data-ai-pending="true"]').length;
      if (remaining > 0) {
        setTimeout(() => this.pollAiStatus(), 3000);
      }
    }, totalWait);
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
          // 委托后无需重新绑定事件
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

function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d)) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}`;
}
/**
 * 全屏图片查看器（Lightbox）
 * - 缩放 25%-400% 8 档
 * - 鼠标拖拽平移（边界限制）
 * - 滚轮缩放
 * - 90° 旋转
 * - 双击重置
 * - ESC 关闭
 */
class Lightbox {
  constructor() {
    this.overlay = document.getElementById('lightboxOverlay');
    this.img = document.getElementById('lightboxImg');
    this.zoomSelect = document.getElementById('lbZoomSelect');
    this.btnOut = document.getElementById('lbZoomOut');
    this.btnIn = document.getElementById('lbZoomIn');
    this.btnRotate = document.getElementById('lbRotate');
    this.btnClose = document.getElementById('lbClose');

    this.zoomLevels = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
    this.scale = 1;
    this.rotation = 0;
    this.translateX = 0;
    this.translateY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartTX = 0;
    this.dragStartTY = 0;
    this.naturalWidth = 0;
    this.naturalHeight = 0;

    if (!this.overlay || !this.img) return;
    this.bindEvents();
  }

  bindEvents() {
    this.btnIn?.addEventListener('click', () => this.zoomStep(1));
    this.btnOut?.addEventListener('click', () => this.zoomStep(-1));
    this.btnRotate?.addEventListener('click', () => this.rotate());
    this.btnClose?.addEventListener('click', () => this.close());
    this.zoomSelect?.addEventListener('change', (e) => {
      this.setZoom(parseFloat(e.target.value));
    });

    this.overlay.addEventListener('click', (e) => {
      // 点击遮罩关闭（非图片本身）
      if (e.target === this.overlay) this.close();
    });

    this.img.addEventListener('mousedown', (e) => this.startDrag(e));
    document.addEventListener('mousemove', (e) => this.onDrag(e));
    document.addEventListener('mouseup', () => this.endDrag());

    // 滚轮缩放
    this.overlay.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomStep(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    // 双击重置
    this.img.addEventListener('dblclick', () => this.reset());

    // 触摸支持
    this.img.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this.startDrag({ clientX: t.clientX, clientY: t.clientY });
      }
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (this.isDragging && e.touches.length === 1) {
        const t = e.touches[0];
        this.onDrag({ clientX: t.clientX, clientY: t.clientY });
      }
    }, { passive: true });
    document.addEventListener('touchend', () => this.endDrag());

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (this.overlay.style.display === 'none' || this.overlay.style.display === '') return;
      if (e.key === 'Escape') this.close();
      else if (e.key === '+' || e.key === '=') this.zoomStep(1);
      else if (e.key === '-' || e.key === '_') this.zoomStep(-1);
      else if (e.key === 'r' || e.key === 'R') this.rotate();
      else if (e.key === '0') this.reset();
    });
  }

  open(src) {
    if (!this.overlay || !this.img) return;
    this.img.src = src;
    this.img.onload = () => {
      this.naturalWidth = this.img.naturalWidth;
      this.naturalHeight = this.img.naturalHeight;
    };
    this.scale = 1;
    this.rotation = 0;
    this.translateX = 0;
    this.translateY = 0;
    this.zoomSelect.value = '1';
    this.applyTransform();
    this.updateButtons();
    this.overlay.style.display = 'flex';
  }

  close() {
    if (!this.overlay) return;
    this.overlay.style.display = 'none';
    this.img.src = '';
  }

  setZoom(value) {
    // 找最接近的档位
    let closest = this.zoomLevels[0];
    let minDiff = Math.abs(value - closest);
    for (const lvl of this.zoomLevels) {
      const diff = Math.abs(value - lvl);
      if (diff < minDiff) { minDiff = diff; closest = lvl; }
    }
    this.scale = closest;
    this.zoomSelect.value = String(this.scale);
    this.clampTranslate();
    this.applyTransform();
    this.updateButtons();
  }

  zoomStep(direction) {
    const currentIdx = this.zoomLevels.indexOf(this.scale);
    const newIdx = Math.max(0, Math.min(this.zoomLevels.length - 1, currentIdx + direction));
    if (newIdx === currentIdx) return;
    this.setZoom(this.zoomLevels[newIdx]);
  }

  rotate() {
    this.rotation = (this.rotation + 90) % 360;
    this.applyTransform();
  }

  reset() {
    this.scale = 1;
    this.rotation = 0;
    this.translateX = 0;
    this.translateY = 0;
    this.zoomSelect.value = '1';
    this.applyTransform();
    this.updateButtons();
  }

  startDrag(e) {
    if (this.scale <= 1) return; // 100% 时不拖
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragStartTX = this.translateX;
    this.dragStartTY = this.translateY;
    this.img.classList.add('dragging');
  }

  onDrag(e) {
    if (!this.isDragging) return;
    this.translateX = this.dragStartTX + (e.clientX - this.dragStartX);
    this.translateY = this.dragStartTY + (e.clientY - this.dragStartY);
    this.applyTransform();
  }

  endDrag() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.img.classList.remove('dragging');
    this.clampTranslate();
    this.applyTransform();
  }

  // 平移边界限制：图片不超出视口中心
  clampTranslate() {
    if (this.scale <= 1) {
      this.translateX = 0;
      this.translateY = 0;
      return;
    }
    // 旋转后尺寸会变：用 cssTransform 后再算
    // 简化：直接用自然宽高 + scale 估算
    const rot = this.rotation % 180 !== 0; // 90 / 270 时尺寸互换
    const w = rot ? this.naturalHeight : this.naturalWidth;
    const h = rot ? this.naturalWidth : this.naturalHeight;
    if (!w || !h) return;

    // 图片以 object-fit: contain 显示，实际显示尺寸按比例缩放进视口
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const containScale = Math.min(vw / w, vh / h);
    const displayW = w * containScale;
    const displayH = h * containScale;
    const scaledW = displayW * this.scale;
    const scaledH = displayH * this.scale;
    const maxX = Math.max(0, (scaledW - vw) / 2);
    const maxY = Math.max(0, (scaledH - vh) / 2);
    this.translateX = Math.max(-maxX, Math.min(maxX, this.translateX));
    this.translateY = Math.max(-maxY, Math.min(maxY, this.translateY));
  }

  applyTransform() {
    if (!this.img) return;
    this.img.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale}) rotate(${this.rotation}deg)`;
  }

  updateButtons() {
    if (this.btnOut) this.btnOut.disabled = this.scale === this.zoomLevels[0];
    if (this.btnIn) this.btnIn.disabled = this.scale === this.zoomLevels[this.zoomLevels.length - 1];
  }
}

// ============= 预览辅助函数 =============

// 打开视频播放器（供 #fileList 和 #galleryGrid 共用）
function openVideoPlayer(streamUrl, fileId, fileName) {
  const modal = document.getElementById('videoPlayerModal');
  const videoPlayer = document.getElementById('videoPlayer');
  const videoFileName = document.getElementById('videoFileName');
  const downloadBtn = document.getElementById('videoDownloadBtn');
  if (!modal || !videoPlayer || !streamUrl) return;
  videoPlayer.src = streamUrl;
  if (videoFileName) videoFileName.textContent = fileName || '';
  if (downloadBtn && fileId) downloadBtn.href = '/files/' + fileId + '/download';
  modal.classList.add('show');
  videoPlayer.play().catch(() => {});
}

async function openPreview(fileId) {
  const modal = document.getElementById('imagePreviewModal');
  if (!modal) return;

  modal._previewData = null;
  modal.classList.add('show');

  // 显示 loading
  const loading = document.getElementById('previewLoading');
  if (loading) loading.classList.add('show');
  const img = document.getElementById('previewImg');
  if (img) img.style.opacity = '0.3';

  try {
    const res = await fetch('/files/' + fileId + '/info');
    const data = await res.json();
    if (!data.success) {
      closePreview();
      alert('文件信息加载失败');
      return;
    }

    const file = data.file;
    modal._previewData = file;

    // 大图
    const previewImg = document.getElementById('previewImg');
    if (previewImg) {
      previewImg.src = '/files/' + fileId + '/preview';
      previewImg.style.opacity = '1';
      previewImg.onload = () => {
        if (loading) loading.classList.remove('show');
      };
      previewImg.onerror = () => {
        if (loading) loading.classList.remove('show');
      };
    }

    // 文件名
    const nameEl = document.getElementById('previewFileName');
    if (nameEl) nameEl.textContent = file.name || '—';

    // 下载
    const dl = document.getElementById('previewDownloadBtn');
    if (dl) dl.href = '/files/' + fileId + '/download';

    // 位置
    const pathEl = document.getElementById('previewFolderPath');
    if (pathEl) pathEl.textContent = file.folderPath ? '/' + file.folderPath : '根目录';

    // 重置重新分析按钮状态
    const reanBtn = document.getElementById('previewReanalyzeBtn');
    if (reanBtn) {
      reanBtn.disabled = false;
      reanBtn.querySelector('span').textContent = '重新分析';
    }

    // AI 字段
    const ai = file.aiAnalysis || {};
    const catSel = document.getElementById('previewCategorySelect');
    if (catSel) catSel.value = ai.category || '其他';

    const sumIn = document.getElementById('previewSummaryInput');
    if (sumIn) sumIn.value = ai.summary || '';

    // 保存 folder 原始 id（从后端 getFileInfo 加进来）
    modal._previewData.folderId = file.folderId || file.folder || null;
    modal._previewData._rawFolderId = file.folderId || file.folder || '';

    // 元信息
    const sizeEl = document.getElementById('previewSize');
    if (sizeEl) sizeEl.textContent = formatSize(file.size);
    const typeEl = document.getElementById('previewType');
    if (typeEl) typeEl.textContent = file.type || file.extension || '—';
    const createdEl = document.getElementById('previewCreated');
    if (createdEl) createdEl.textContent = formatDate(file.createdAt);

    // 标签
    renderPreviewTags(ai.labels || []);
  } catch (err) {
    console.error('openPreview error:', err);
    closePreview();
  }
}

function closePreview() {
  const modal = document.getElementById('imagePreviewModal');
  if (!modal) return;
  modal.classList.remove('show');
  modal._previewData = null;
  const img = document.getElementById('previewImg');
  if (img) {
    img.src = '';
    img.style.opacity = '1';
  }
  const loading = document.getElementById('previewLoading');
  if (loading) loading.classList.remove('show');
  // 清空保存提示
  ['previewCategorySave', 'previewSummarySave', 'previewTagsSave'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('show'); el.textContent = ''; }
  });
}

function renderPreviewTags(labels) {
  const container = document.getElementById('previewTags');
  if (!container) return;
  container.innerHTML = '';
  labels.forEach((label, idx) => {
    const tag = document.createElement('span');
    tag.className = 'preview-tag';
    const textNode = document.createTextNode(label);
    tag.appendChild(textNode);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'preview-tag-remove';
    removeBtn.dataset.idx = String(idx);
    removeBtn.textContent = '×';
    tag.appendChild(removeBtn);
    container.appendChild(tag);
  });
}

function showSaveHint(elemId, ok, msg) {
  const el = document.getElementById(elemId);
  if (!el) return;
  el.textContent = msg || (ok ? '✓ 已保存' : '保存失败');
  el.classList.remove('error');
  if (!ok) el.classList.add('error');
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2000);
}

async function saveAiAnalysis(patch) {
  const modal = document.getElementById('imagePreviewModal');
  if (!modal || !modal._previewData) return;
  const fileId = modal._previewData.id;

  try {
    const res = await fetch('/files/' + fileId + '/ai-analysis', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    const data = await res.json();
    if (data.success) {
      // 更新本地缓存
      if (!modal._previewData.aiAnalysis) modal._previewData.aiAnalysis = {};
      Object.assign(modal._previewData.aiAnalysis, data.aiAnalysis);
      // 显示提示
      if ('category' in patch) showSaveHint('previewCategorySave', true);
      if ('summary' in patch) showSaveHint('previewSummarySave', true);
      if ('labels' in patch) {
        renderPreviewTags(data.aiAnalysis.labels || []);
        showSaveHint('previewTagsSave', true);
      }
    } else {
      const hintId = 'category' in patch ? 'previewCategorySave'
        : 'summary' in patch ? 'previewSummarySave' : 'previewTagsSave';
      showSaveHint(hintId, false, '保存失败：' + (data.message || ''));
    }
  } catch (err) {
    console.error('saveAiAnalysis error:', err);
  }
}

async function deleteCurrentFile() {
  const modal = document.getElementById('imagePreviewModal');
  if (!modal || !modal._previewData) return;
  const file = modal._previewData;
  if (!confirm('确定删除文件 "' + file.name + '" 吗？此操作不可撤销。')) return;

  try {
    const res = await fetch('/files/' + file.id, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      closePreview();
      // 从 DOM 中移除该文件项
      const fileItem = document.querySelector('.file-item-row[data-id="' + file.id + '"]');
      if (fileItem) fileItem.remove();
      // 也可以 location.reload() 强制刷新，但移除 DOM 更流畅
    } else {
      alert('删除失败：' + (data.message || ''));
    }
  } catch (err) {
    console.error('deleteCurrentFile error:', err);
    alert('删除失败');
  }
}

// ============= 路径编辑 =============
async function openFolderPicker() {
  const modal = document.getElementById('previewFolderPicker');
  if (!modal) return;
  modal._selectedFolderId = null;
  modal.classList.add('show');
  await populatePreviewFolderTree();
}

function closeFolderPicker() {
  const modal = document.getElementById('previewFolderPicker');
  if (modal) modal.classList.remove('show');
}

async function populatePreviewFolderTree() {
  const tree = document.getElementById('previewFolderTree');
  if (!tree) return;
  tree.innerHTML = '';
  tree._selectedEl = null;
  tree._selectedFolderId = '';

  // 根目录（不默认选中，用户必须点选才能确定）
  const root = document.createElement('div');
  root.className = 'folder-item root';
  root.dataset.id = '';
  root.dataset.selectable = 'true';
  root.innerHTML = '<span class="folder-icon">📂</span><span class="folder-name">全部文件（根目录）</span>';
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tree._selectedEl) tree._selectedEl.classList.remove('selected');
    root.classList.add('selected');
    tree._selectedEl = root;
    tree._selectedFolderId = '';
  });
  tree.appendChild(root);

  try {
    const res = await fetch('/folders', { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) return;

    const folderMap = {};
    const rootFolders = [];
    data.data.forEach(f => { folderMap[f._id] = { ...f, children: [] }; });
    data.data.forEach(f => {
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
      item.dataset.selectable = 'true';
      item.style.paddingLeft = (12 + depth * 16) + 'px';
      item.innerHTML = '<span class="folder-icon">📁</span><span class="folder-name">' + node.name + '</span>';
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (tree._selectedEl) tree._selectedEl.classList.remove('selected');
        item.classList.add('selected');
        tree._selectedEl = item;
        tree._selectedFolderId = node._id;
      });
      tree.appendChild(item);
      if (node.children?.length > 0) {
        node.children.forEach(c => renderNode(c, depth + 1));
      }
    };
    rootFolders.forEach(n => renderNode(n, 1));
  } catch (e) {
    console.error('populatePreviewFolderTree error:', e);
  }
}

async function confirmFolderChange() {
  const modal = document.getElementById('previewFolderPicker');
  const mainModal = document.getElementById('imagePreviewModal');
  if (!modal || !mainModal || !mainModal._previewData) {
    closeFolderPicker();
    return;
  }
  const fileId = mainModal._previewData.id;

  // 收集选中的文件夹 id（根目录时为空字符串）
  const tree = document.getElementById('previewFolderTree');
  const selectedEl = tree?.querySelector('.folder-item.selected');
  const folderId = selectedEl?.dataset.id || '';
  // 不变就没动
  const currentFolderId = mainModal._previewData._rawFolderId || '';

  // 总是先关闭弹窗，再处理保存
  closeFolderPicker();

  if (folderId === currentFolderId) return;

  try {
    const res = await fetch('/files/' + fileId + '/move', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderId || null })
    });
    const data = await res.json();
    if (data.success) {
      // 更新本地缓存
      mainModal._previewData.folderId = folderId || null;
      mainModal._previewData._rawFolderId = folderId;
      // 重新拉详情以更新路径字符串
      await refreshPreviewInfo();
    } else {
      alert('移动失败：' + (data.message || ''));
    }
  } catch (e) {
    console.error('confirmFolderChange error:', e);
    alert('移动失败');
  }
}

async function refreshPreviewInfo() {
  const modal = document.getElementById('imagePreviewModal');
  if (!modal || !modal._previewData) return;
  const fileId = modal._previewData.id;

  try {
    const res = await fetch('/files/' + fileId + '/info');
    const data = await res.json();
    if (!data.success) return;
    modal._previewData = { ...modal._previewData, ...data.file };

    const pathEl = document.getElementById('previewFolderPath');
    if (pathEl) pathEl.textContent = data.file.folderPath ? '/' + data.file.folderPath : '根目录';
  } catch (e) {
    console.error('refreshPreviewInfo error:', e);
  }
}

// ============= AI 重新分析 =============
async function reanalyzeCurrentFile() {
  const modal = document.getElementById('imagePreviewModal');
  if (!modal || !modal._previewData) return;
  const fileId = modal._previewData.id;

  const btn = document.getElementById('previewReanalyzeBtn');
  if (btn) {
    btn.disabled = true;
    btn.querySelector('span').textContent = '分析中...';
  }

  try {
    const res = await fetch('/files/' + fileId + '/analyze', { method: 'POST' });
    const data = await res.json();
    if (!data.success) {
      alert('启动分析失败：' + (data.message || ''));
      if (btn) {
        btn.disabled = false;
        btn.querySelector('span').textContent = '重新分析';
      }
      return;
    }

    if (data.status === 'skipped') {
      alert(data.message || '此文件不支持 AI 分析');
      if (btn) {
        btn.disabled = false;
        btn.querySelector('span').textContent = '重新分析';
      }
      return;
    }

    // 立即轮询
    pollAnalyzeStatus(fileId, 0);
  } catch (e) {
    console.error('reanalyzeCurrentFile error:', e);
    if (btn) {
      btn.disabled = false;
      btn.querySelector('span').textContent = '重新分析';
    }
    alert('启动分析失败');
  }
}

async function pollAnalyzeStatus(fileId, attempt) {
  const modal = document.getElementById('imagePreviewModal');
  if (!modal || modal._previewData?.id !== fileId) return; // 用户已切换/关闭

  const MAX_ATTEMPTS = 60; // 最多轮询 60 次（5 分钟）

  if (attempt >= MAX_ATTEMPTS) {
    const btn = document.getElementById('previewReanalyzeBtn');
    if (btn) {
      btn.disabled = false;
      btn.querySelector('span').textContent = '重新分析';
    }
    alert('分析超时');
    return;
  }

  try {
    const res = await fetch('/files/' + fileId + '/ai-status');
    const data = await res.json();
    if (data.status === 'done') {
      // 刷新右栏所有 AI 字段
      const btn = document.getElementById('previewReanalyzeBtn');
      if (btn) {
        btn.disabled = false;
        btn.querySelector('span').textContent = '重新分析';
      }

      // 显示"已更新"提示
      showSaveHint('previewSummarySave', true, '✓ 已重新分析');

      // 直接更新字段
      if (data.result) {
        const catSel = document.getElementById('previewCategorySelect');
        if (catSel) catSel.value = data.result.category || '其他';
        const sumIn = document.getElementById('previewSummaryInput');
        if (sumIn) sumIn.value = data.result.summary || '';
        renderPreviewTags(data.result.labels || []);
      } else {
        // 没返回 result，重新拉详情
        await refreshPreviewInfo();
      }
      return;
    }
  } catch (e) {
    console.error('pollAnalyzeStatus error:', e);
  }

  // 每 5 秒轮询
  setTimeout(() => pollAnalyzeStatus(fileId, attempt + 1), 5000);
}
