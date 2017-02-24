define(['require', 'jquery', 'base/js/dialog', 'base/js/namespace'],
       function (require, $, dialog, Jupyter) {
  function Saagie () {
    this.platformsUrl = '/api-internal/v1/platform';
    this.loginUrl = '/login_check';
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
    this.alreadyOpened = false;
    this.createModal();
    this.createButtonsGroup();
  }

  Saagie.prototype.getCreateJobUrl = function (platformId) {
    return '/api-internal/v1/platform/' + platformId.toString() + '/job';
  };

  Saagie.prototype.request = function (method, url, data, allowRedirects) {
    var updatedData = {method: method, url: url,
                       allow_redirects: allowRedirects};
    if (typeof data !== 'undefined') {
      $.extend(updatedData, data);
    }
    return $.ajax({
      url: '/saagie/proxy',
      method: 'POST',
      data: updatedData,
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
      this.$modalContent.html(html);
    }.bind(this));
  };

  Saagie.prototype.createModal = function () {
    this.getTemplate('modal.html').done(function (html) {
      var $body = $('body');
      this.$modal = $(html);
      this.$modalContent = this.$modal.find('.modal-content');
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
  };

  Saagie.prototype.openModal = function () {
    this.onModalOpen();
    if (this.alreadyOpened) {
      return;
    }
    this.alreadyOpened = true;
    this.checkLogged(function () {
      this.createJobFormView();
    }.bind(this));
  };

  Saagie.prototype.checkLogged = function (successFunction, failureFunction) {
    if (typeof successFunction === 'undefined') {
      successFunction = function () {};
    }
    if (typeof failureFunction === 'undefined') {
      failureFunction = function (jqXHR) {
        if (jqXHR.status == 302) {
          this.logView();
        }
      }.bind(this);
    }

    return this.request('GET', this.platformsUrl, {},
                        false).done(function (data, textStatus, jqXHR) {
      console.assert(jqXHR.status == 200, 'Unexpected status ' + jqXHR.status);
      successFunction(data, textStatus, jqXHR);
    }).fail(failureFunction);
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
          this.checkLogged(function () {
            this.createJobFormView();
          }.bind(this), function () {
            $form.find('.alert').removeClass('hidden');
            $submitButton.find('.fa-spin').detach();
          });
        }.bind(this));
      }.bind(this));
      this.$modalContent.html($form);
    }.bind(this));
  };

  Saagie.prototype.createJobFormView = function () {
    this.request('GET', this.platformsUrl).done(function (platformsData) {
      this.renderTemplate('job_form.html', {
        notebook_name: Jupyter.notebook.get_notebook_name(),
        platforms_data: $.map(JSON.parse(platformsData), function (el) {
          return el['id'].toString() + ':' + el['name'];
        }).join(',')
      });
      this.$modalContent.submit(function (e) {
        e.preventDefault();
        this.createJobView();
      }.bind(this));
    }.bind(this));
  };

  Saagie.prototype.createJobView = function () {
    var kernel = Jupyter.notebook.kernel.name;
    if (kernel in this.kernelNames) {
      kernel = this.kernelNames[kernel];
    } else {
      this.renderTemplate('unsupported_kernel.html', {kernel: kernel});
      return;
    }
    var platformId = $('#saagie-platform').val();
    this.request('POST', this.getCreateJobUrl(platformId), {
      json: JSON.stringify({
        platform_id: platformId,
        capsule_code: 'jupiter',
        category: 'processing',
        name: $('#saagie-job-name').val(),
        current: {
          cpu: $('#saagie-cpu').val(),
          disk: $('#saagie-disk').val(),
          memory: $('#saagie-ram').val(),
          options: {
            notebook: kernel
          }
        }
      })
    }).done(function (data) {
      data = JSON.parse(data);
      this.uploadNotebook(platformId, data.id, 'https://' + data.current.url,
                          true);
    }.bind(this));
    this.renderTemplate('creating_job.html');
  };

  Saagie.prototype.uploadNotebook = function (platformId, id, url,
                                              updateModal) {
    if (typeof updateModal === 'undefined') {
      updateModal = false;
    }
    var notebookName = Jupyter.notebook.notebook_name;
    var templateData = {platform_id: platformId, id: id,
                        url: url + '/notebooks/' + notebookName};
    if (updateModal) {
      this.renderTemplate('starting_job.html', templateData);
    }
    var uploadUrl = url + '/api/contents/' + notebookName;
    this.request('GET', url).done(function () {
      this.request('PUT', uploadUrl,
                   {json: JSON.stringify(
                     {content: Jupyter.notebook.toJSON()})})
      .done(function () {
        this.renderTemplate('started_job.html', templateData);
      }.bind(this));
    }.bind(this)).fail(function () {
      setTimeout(function () {
        this.uploadNotebook(platformId, id, url);
      }.bind(this), 1000);
    }.bind(this));
  };

  var load_extension = function () {
    $.ajax({url: '/saagie/check', timeout: 6000}).done(function () {
      saagie = new Saagie();
    }).fail(function () {
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
