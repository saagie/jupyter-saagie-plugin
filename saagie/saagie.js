define(['require', 'jquery', 'base/js/dialog', 'base/js/namespace'],
       function (require, $, dialog, Jupyter) {
  function Saagie () {
    this.configUrl = '/api-internal/v1/platform';
    this.loginUrl = '/login_check';
    this.createJobUrl = '/api-internal/v1/platform/2/job';
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
      timeout: 10000
    }).fail(function (xhr) {
      if (xhr.status == 500) {
        alert('Connection issue with the Saagie server.');
      }
    });
  };

  Saagie.prototype.getTemplate = function (template, data) {
    var updatedData = {template: template};
    if (typeof data !== 'undefined') {
      $.extend(updatedData, data);
    }
    return $.ajax({
      url: '/saagie',
      data: updatedData
    }).fail(function (xhr) {
      if (xhr.status == 500) {
        alert('Connection issue with the Jupyter server.');
      }
    });
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
      Jupyter.keyboard_manager.disable();
      this.$modal.on('hidden.bs.modal', function () {
        Jupyter.keyboard_manager.enable();
      });
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

  Saagie.prototype.openModal = function () {
    var cell = Jupyter.notebook.get_selected_cell();
    var data = {};
    if (typeof cell.kernel !== 'undefined') {
      data['Kernel'] = cell.kernel.name;
    }
    data['Cell type'] = cell.cell_type;
    data['Content'] = $('<pre></pre>').text(cell.get_text());

    var $dl = $('<dl class="dl-horizontal"></dl>');
    $.each(data, function (key, value) {
      $dl.append($('<dt></dt>').text(key))
        .append($('<dd></dd>').html(value));
    });
    this.$modalBody.html($dl);

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
    this.getTemplate('form.html').done(function (html) {
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
    this.$modalBody.html('<p>Starting job…</p>');
    this.$modalFooter.empty();
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
          notebook: 'jupyter'
        }
      }
    })}, false).done(function (data) {
      data = JSON.parse(data);
      this.uploadNotebook(data.id, 'https://' + data.current.url);
    }.bind(this));
  };

  Saagie.prototype.uploadNotebook = function (id, url) {
    var notebookName = Jupyter.notebook.notebook_name;
    var uploadUrl = url + '/api/contents/' + notebookName;
    this.request('GET', url).done(function () {
      this.request('PUT', uploadUrl,
                   {json: JSON.stringify(
                     {content: Jupyter.notebook.toJSON()})})
      .done(function () {
        this.getTemplate('job_details.html',
                         {id: id, url: url + '/notebooks/' + notebookName})
          .done(function (html) {
            this.$modalBody.html(html);
          }.bind(this));
      }.bind(this));
    }.bind(this)).fail(function () {
      setTimeout(function () {
        this.uploadNotebook(id, url);
      }.bind(this), 1000);
    }.bind(this));
  };

  var load_extension = function () {
    $.ajax('/saagie/check').done(function () {
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
