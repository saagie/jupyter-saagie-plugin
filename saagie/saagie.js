var saagie;

define(['require', 'jquery', 'base/js/dialog', 'base/js/namespace'],
       function (require, $, dialog, Jupyter) {
  function Saagie () {
    this.createModal();
    this.createButtonsGroup();
    this.currentTimeout = -1;
  }

  Saagie.prototype.addNotebookData = function (data) {
    data.notebook_path = Jupyter.notebook.notebook_path;
    data.notebook_json = JSON.stringify(Jupyter.notebook.toJSON());
  };

  Saagie.prototype.rawView = function (url, data, method, showSpinner) {
    if (typeof data === 'undefined') {
      data = {};
    }
    this.addNotebookData(data);
    if (typeof method === 'undefined') {
      method = 'GET';
    }
    if (typeof showSpinner === 'undefined') {
      showSpinner = true;
    }
    if (showSpinner) {
      this.$modal.find('.modal-body').html(
        '<div style="text-align: center;">' +
        '<i class="fa fa-spinner fa-spin fa-3x"></i>' +
        '</div>');
    }
    return $.ajax({
      method: method,
      url: url,
      data: data,
      cache: false
    }).always(function (html, textStatus) {
      if (textStatus === 'error') {
        html = html.responseText;  // In case of error, jqXHR is the first arg.
      }
      var $modalContent = $(html);
      this.$modal.find('.modal-content').replaceWith($modalContent);

      $modalContent.submit(function (event) {
        event.preventDefault();
        var serialized = $modalContent.serializeArray(), data = {};
        serialized.forEach(function (element) {
          var value = element.value;
          if (element.name in data) {
            value = data[element.name] + '|' + element.value;
          }
          data[element.name] = value;
        });
        this.rawView($modalContent.attr('action'),
                     data,
                     $modalContent.attr('method'));
      }.bind(this));

      $modalContent.find('[data-href]').click(function (event) {
        event.preventDefault();
        this.rawView($(event.target).data('href'));
      }.bind(this));

      var url = $modalContent.data('auto-refresh-url');
      if (typeof url !== 'undefined') {
        this.currentTimeout = setTimeout(function () {
          this.rawView(url, {}, 'GET', false);
        }.bind(this), 3000);
      }

    }.bind(this));
  };

  Saagie.prototype.view = function (viewName, data, method) {
    return this.rawView('/saagie?view=' + viewName, data, method);
  };

  Saagie.prototype.createModal = function () {
    var data = {};
    this.addNotebookData(data);
    $.ajax('/saagie?view=modal', data).done(function (html) {
      this.$modal = $(html);
      $('body').append(this.$modal);
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
    clearTimeout(this.currentTimeout);
    Jupyter.keyboard_manager.enable();
  };

  Saagie.prototype.openModal = function () {
    this.onModalOpen();
    this.view('login_form');
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
