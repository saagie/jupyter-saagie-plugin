#!/usr/bin/env python

import os
from setuptools import setup
from setuptools.command.install import install

from notebook.nbextensions import install_nbextension
from notebook.services.config import ConfigManager
from jupyter_core.paths import jupyter_config_dir


EXTENSION_PATH = os.path.join(os.path.dirname(__file__), 'saagie')


class InstallCommand(install):
    def run(self):
        # Installs Python package & its dependencies.
        super(InstallCommand, self).run()

        # Installs JS extensions to ~/.local/share/jupyter/nbextensions
        install_nbextension(EXTENSION_PATH, overwrite=True, user=True)

        # Enables the JS extension.
        js_cm = ConfigManager()
        section = 'notebook'
        cfg = js_cm.get(section)
        extensions = cfg['load_extensions'] = cfg.setdefault('load_extensions',
                                                             {})
        extensions['saagie/saagie'] = True
        js_cm.update(section, cfg)

        # Enables the Python server extension.
        server_cm = ConfigManager(write_config_dir=jupyter_config_dir())
        section = 'jupyter_notebook_config'
        cfg = server_cm.get(section)
        app = cfg['NotebookApp'] = cfg.setdefault('NotebookApp', {})
        server_extensions = app['server_extensions'] = \
            app.setdefault('server_extensions', [])
        server_extension = 'saagie'
        if server_extension not in server_extensions:
            server_extensions.append(server_extension)
        server_cm.update(section, cfg)


setup(
    name='jupyter-saagie-plugin',
    version='0.1',
    packages=['saagie'],
    cmdclass={
        'install': InstallCommand,
    },
    install_requires=['requests==2.12.5'],
    include_package_data=True,
)
