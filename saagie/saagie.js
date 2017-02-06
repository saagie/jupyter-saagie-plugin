define(['require', 'jquery', 'base/js/dialog', 'base/js/namespace'],
       function (require, $, dialog, Jupyter) {
  function Saagie () {
    this.configUrl = '/api-internal/v1/platform';
    this.loginUrl = '/login_check';
    this.createJobUrl = '/api-internal/v1/platform/2/job';
    // Binds Jupyter kernel names to Saagie kernel names.
    this.kernelNames = {
      python2: 'jupyter',
      python3: 'jupyter',
      ir: 'r',
      spark: 'scala-spark1.6',
      ruby: 'ruby',
      haskell: 'haskell',
      'julia-0.3': 'julia'
    };
    this.currentTimeout = -1;
    this.createModal();
    this.createButtonsGroup();
  }

  Saagie.prototype.request = function (method, url, data, async) {
    if (typeof async === 'undefined') {
      async = true;
    }
    var updatedData = {method: method, url: url};
    if (typeof data !== 'undefined') {
      $.extend(updatedData, data);
    }
    return $.ajax({
      url: '/saagie-proxy',
      method: 'POST',
      data: updatedData,
      async: async,
      timeout: 6000
    }).fail(function (xhr) {
      if (xhr.status == 500) {
        this.renderTemplate('connection_error.html');
        throw 'Unable to connect to Saagie.';
      }
    }.bind(this));
  };

  Saagie.prototype.getTemplate = function (template, data) {
    var updatedData = {template: template};
    if (typeof data !== 'undefined') {
      $.extend(updatedData, data);
    }
    return $.ajax({
      url: '/saagie',
      data: updatedData,
      timeout: 6000
    }).fail(function (xhr) {
      if (xhr.status == 500) {
        alert('Connection issue with the Jupyter server.');
      }
    });
  };

  Saagie.prototype.renderTemplate = function (template, data) {
    this.getTemplate(template, data).done(function (html) {
      this.$modalBody.html(html);
    }.bind(this));
  };

  Saagie.prototype.initModal = function () {
    this.$modalContent = this.$modal.find('.modal-content');
    this.$modalBody = this.$modalContent.find('.modal-body');
    this.$modalFooter = this.$modalContent.find('.modal-footer');
  };

  Saagie.prototype.createModal = function () {
    this.getTemplate('modal.html').done(function (html) {
      var $body = $('body');
      this.$modal = $(html);
      this.initModal();
      $body.append(this.$modal);
      this.$modal.on('hidden.bs.modal', this.onModalClose.bind(this));
    }.bind(this));
  };

  Saagie.prototype.createButtonsGroup = function () {
    this.$btnGroup = Jupyter.toolbar.add_buttons_group([{
      label: 'Deploy to Saagie',
      callback: this.openModal.bind(this)
    }]);
    this.$btnGroup.find('button')
      .attr('data-toggle', 'modal').attr('data-target', '#saagie-modal')
      .html('<img src="' + require.toUrl('./saagie-button.png')
            + '" width="11" height="17" />');
  };

  Saagie.prototype.onModalOpen = function () {
    Jupyter.keyboard_manager.disable();
  } ;

  Saagie.prototype.onModalClose = function () {
    Jupyter.keyboard_manager.enable();
    clearTimeout(this.currentTimeout);
  };

  Saagie.prototype.openModal = function () {
    this.onModalOpen();
    if (!this.isLogged()) {
      this.logView();
    } else {
      this.createJobView();
    }
  };

  Saagie.prototype.isLogged = function () {
    return this.request('GET', this.configUrl, {}, false).status == 200;
  };

  Saagie.prototype.log = function (username, password) {
    return this.request('POST', this.loginUrl,
                        {_username: username, _password: password});
  };

  Saagie.prototype.logView = function () {
    this.getTemplate('login_form.html').done(function (html) {
      var $form = $(html);
      var $submitButton = $form.find('button[type="submit"]');
      $form.submit(function (e) {
        e.preventDefault();
        $submitButton.prepend('<i class="fa fa-refresh fa-fw fa-spin"></i> ');
        var username = $form.find('#username').val(),
            password = $form.find('#password').val();
        this.log(username, password).done(function () {
          if (this.isLogged()) {
            this.createJobView();
          } else {
            $form.find('.alert').removeClass('hidden');
            $submitButton.find('.fa-spin').detach();
          }
        }.bind(this));
      }.bind(this));
      this.$modalContent.html($form);
      this.initModal();
    }.bind(this));
  };

  Saagie.prototype.createJobView = function () {
    this.renderTemplate('creating_job.html');
    this.$modalFooter.empty();
    var kernel = Jupyter.notebook.kernel.name;
    if (kernel in this.kernelNames) {
      kernel = this.kernelNames[kernel];
    } else {
      this.renderTemplate('unsupported_kernel.html', {kernel: kernel});
      return;
    }
    this.request('POST', this.createJobUrl, {json: JSON.stringify({
      platform_id: '2',
      capsule_code: 'jupiter',
      category: 'processing',
      name: Jupyter.notebook.get_notebook_name(),
      current: {
        cpu: 0.6,
        disk: 1024,
        memory: 1024,
        options: {
          notebook: kernel
        }
      }
    })}, false).done(function (data) {
      data = JSON.parse(data);
      this.uploadNotebook(data.id, 'https://' + data.current.url, true);
    }.bind(this));
  };

  Saagie.prototype.uploadNotebook = function (id, url, updateModal) {
    if (typeof updateModal === 'undefined') {
      updateModal = false;
    }
    var notebookName = Jupyter.notebook.notebook_name;
    var templateData = {id: id, url: url + '/notebooks/' + notebookName};
    if (updateModal) {
      this.renderTemplate('starting_job.html', templateData);
    }
    var uploadUrl = url + '/api/contents/' + notebookName;
    this.request('GET', url).done(function () {
      this.request('PUT', uploadUrl,
                   {json: JSON.stringify(
                     {content: Jupyter.notebook.toJSON()})})
      .done(function () {
        this.renderTemplate('job_details.html', templateData);
      }.bind(this));
    }.bind(this)).fail(function () {
      this.currentTimeout = setTimeout(function () {
        this.uploadNotebook(id, url);
      }.bind(this), 1000);
    }.bind(this));
  };

  var load_extension = function () {
    $.ajax({url: '/saagie/check', timeout: 6000}).done(function () {
      saagie = new Saagie();
    }).error(function () {
      console.error(
        'Unable to find the saagie Python module, please install ' +
        'jupyter-saagie-plugin in this Python environment.');
    });
  };

  return {
    load_jupyter_extension: load_extension,
    load_ipython_extension: load_extension
  };
});
