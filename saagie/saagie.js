var saagie;

define(['require', 'jquery', 'base/js/dialog', 'base/js/namespace'],
       function (require, $, dialog, Jupyter) {
  function JobRun(job, runData) {
    this.job = job;
    this.id = runData.id;
    this.status = runData.status;
    this.stderr = runData.logs_err;
    this.stdout = runData.logs_out;
  }

  function Job(saagie, jobData) {
    this.saagie = saagie;
    this.platformId = jobData.platform_id;
    this.capsuleType = jobData.capsule_code;
    this.id = jobData.id;
    this.name = jobData.name;
    this.url = this.saagie.getCreateJobUrl(this.platformId)
               + '/' + this.id.toString();
    if (this.isJupyter()) {
      this.jupyterUrl = 'https://' + jobData.current.url;
      this.notebookName = Jupyter.notebook.notebook_name;
    }
    this.lastRun = null;
    this.displayStarting();
    this.fetchLogs();
  }

  Job.prototype.isJupyter = function () {
    // Yes, this is a typo from Saagie internals.
    return this.capsuleType == 'jupiter';
  };

  Job.prototype.getTemplateData = function () {
    var prefix = this.isJupyter() ? 'jupyter' : 'python';
    var jobDetailsTemplateName = 'include/' + prefix + '_job_details.html';
    var templateData = {platform_id: this.platformId,
                        job_details_template_name: jobDetailsTemplateName,
                        id: this.id};
    if (this.lastRun !== null) {
      templateData.stderr = this.lastRun.stderr;
      templateData.stdout = this.lastRun.stdout;
    }
    if (this.isJupyter()) {
      templateData.jupyter_url =
        this.jupyterUrl + '/notebooks/' + this.notebookName;
    }
    return templateData;
  };

  Job.prototype.displayStarting = function () {
    this.saagie.renderTemplate('starting_job.html', this.getTemplateData());
  };

  Job.prototype.displayStarted = function () {
    this.saagie.renderTemplate('started_job.html', this.getTemplateData());
  };

  Job.prototype.fetchLogs = function () {
    this.saagie.request('GET', this.url).done(function (data) {
      data = JSON.parse(data);
      var runData = data.last_instance;
      if ((typeof runData === 'undefined') || (runData.status != 'SUCCESS')) {
        setTimeout(this.fetchLogs.bind(this), 1000);
        return;
      }
      this.saagie.request(
        'GET', '/api-internal/v1/jobtask/' + runData.id.toString())
        .done(function (data) {
          this.lastRun = new JobRun(this, JSON.parse(data));
          if (this.isJupyter()) {
            this.uploadNotebook();
          } else {
            this.displayStarted();
          }
        }.bind(this));
    }.bind(this));
  };

  Job.prototype.uploadNotebook = function () {
    var uploadUrl = this.jupyterUrl + '/api/contents/' + this.notebookName;
    this.saagie.request('GET', this.jupyterUrl).done(function () {
      this.saagie.request(
        'PUT', uploadUrl, {
          json: JSON.stringify({content: Jupyter.notebook.toJSON()})})
      .done(function () {
        this.displayStarted()
      }.bind(this));
    }.bind(this)).fail(function () {
      setTimeout(function () {
        this.uploadNotebook();
      }.bind(this), 1000);
    }.bind(this));
  };

  function Saagie () {
    this.platformsUrl = '/api-internal/v1/platform';
    this.loginUrl = '/login_check';
    // Binds Jupyter kernel names to Saagie kernel names.
    this.jupyterKernelNames = {
      python2: 'jupyter',
      python3: 'jupyter',
      ir: 'r',
      spark: 'scala-spark1.6',
      ruby: 'ruby',
      haskell: 'haskell',
      'julia-0.3': 'julia'
    };
    this.alreadyOpened = false;
    this.currentJob = null;
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
    return this.getTemplate(template, data).done(function (html) {
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
      this.capsuleTypeChooserView();
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
            this.capsuleTypeChooserView();
          }.bind(this), function () {
            $form.find('.alert').removeClass('hidden');
            $submitButton.find('.fa-spin').detach();
          });
        }.bind(this));
      }.bind(this));
      this.$modalContent.html($form);
    }.bind(this));
  };

  Saagie.prototype.capsuleTypeChooserView = function () {
    this.renderTemplate('capsule_type_chooser.html').done(function () {
      this.$modalContent.find('.deploy-python').click(function () {
        this.createJobFormView('python_job_form.html',
                               this.createPythonJobView.bind(this));
      }.bind(this));
      this.$modalContent.find('.deploy-jupyter').click(function () {
        this.createJobFormView('jupyter_job_form.html',
                               this.createJupyterJobView.bind(this));
      }.bind(this));
    }.bind(this));
  };

  Saagie.prototype.createJobFormView = function (templateName, onSubmit) {
    this.request('GET', this.platformsUrl).done(function (platformsData) {
      this.renderTemplate(templateName, {
        notebook_name: Jupyter.notebook.get_notebook_name(),
        platforms_data: $.map(JSON.parse(platformsData), function (el) {
          return el['id'].toString() + ':' + el['name'];
        }).join(',')
      });
      this.$modalContent.submit(function (e) {
        e.preventDefault();
        onSubmit();
      }.bind(this));
    }.bind(this));
  };

  Saagie.prototype.getFieldValue = function (name) {
    return this.$modalContent.find('[name="' + name + '"]').val();
  };

  Saagie.prototype.createBaseJobData = function () {
    return {
      platform_id: this.getFieldValue('saagie-platform'),
      category: 'processing',
      name: this.getFieldValue('job-name'),
      description: this.getFieldValue('description'),
      current: {
        cpu: this.getFieldValue('cpu'),
        disk: this.getFieldValue('disk'),
        memory: this.getFieldValue('ram'),
        options: {}
      }
    };
  };

  Saagie.prototype.createJobView = function (jobData) {
    return this.request('POST', this.getCreateJobUrl(jobData.platform_id), {
      json: JSON.stringify(jobData)
    }).done(function (data) {
      this.currentJob = new Job(this, JSON.parse(data));
    }.bind(this));
  };

  Saagie.prototype.getCode = function () {
    var code = '';
    Jupyter.notebook.get_cells().forEach(function (cell) {
      if (cell.cell_type != 'code') {
        return;
      }
      if (code) {
        code += '\n\n\n';
      }
      code += cell.get_text();
    });
    return code;
  };

  Saagie.prototype.createPythonJobView = function () {
    this.renderTemplate('creating_job.html');
    var jobData = this.createBaseJobData();
    jobData.capsule_code = 'python';
    jobData.current.options.language_version = this.getFieldValue('language-version');
    jobData.current.releaseNote = this.getFieldValue('release-note');
    jobData.current.template = this.getFieldValue('shell-command');
    var uploadUrl = this.getCreateJobUrl(this.getFieldValue('saagie-platform'));
    uploadUrl += '/upload';
    this.request('POST', uploadUrl, {
      filename: this.getFieldValue('job-name'),
      file: this.getCode()
    }).done(function (data) {
      jobData.current.file = JSON.parse(data).fileName;
      this.createJobView(jobData);
    }.bind(this));
  };

  Saagie.prototype.createJupyterJobView = function () {
    this.renderTemplate('creating_job.html');
    var kernel = Jupyter.notebook.kernel.name;
    if (kernel in this.jupyterKernelNames) {
      kernel = this.jupyterKernelNames[kernel];
    } else {
      this.renderTemplate('unsupported_kernel.html', {kernel: kernel});
      return;
    }
    var jobData = this.createBaseJobData();
    jobData.capsule_code = 'jupiter';
    jobData.current.options.notebook = kernel;
    this.createJobView(jobData);
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
