#!/usr/bin/env python

import os
from setuptools import setup
from setuptools.command.install import install

from saagie import __version__

try:
    from pypandoc import convert
except ImportError:
    import io

    def convert(filename, fmt):
        with io.open(filename, encoding='utf-8') as fd:
            return fd.read()

CURRENT_PATH = os.path.abspath(os.path.dirname(__file__))
EXTENSION_PATH = os.path.join(CURRENT_PATH, 'saagie')

with open(os.path.join(CURRENT_PATH, 'requirements.txt')) as f:
    required = f.read().splitlines()


def setup_extensions():
    try:
        from notebook.nbextensions import install_nbextension
        from notebook.services.config import ConfigManager
        from jupyter_core.paths import jupyter_config_dir
    except ImportError:
        raise ImportError('Install Jupyter notebook before.')

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
    server_extension = 'saagie.server_extension'
    if server_extension not in server_extensions:
        server_extensions.append(server_extension)
    server_cm.update(section, cfg)


class InstallCommand(install):
    def run(self):
        # Installs Python package & its dependencies.
        install.do_egg_install(self)

        self.execute(setup_extensions, (),
                     msg='Installing Jupyter JS & server extensions...')


setup(
    name='jupyter-saagie-plugin',
    version=__version__,
    author='Saagie',
    author_email='support@saagie.com',
    url='https://github.com/saagie/jupyter-saagie-plugin',
    description='Easily create a Saagie Python job from a Jupyter notebook',
    long_description=convert('README.md', 'rst'),
    classifiers=[
        'Development Status :: 5 - Production/Stable',
        'Framework :: Django',
        'Intended Audience :: Developers',
        'License :: OSI Approved :: Apache Software License',
        'Operating System :: OS Independent',
        'Programming Language :: Python :: 2',
        'Programming Language :: Python :: 2.7',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.4',
        'Programming Language :: Python :: 3.5',
        'Programming Language :: Python :: 3.6',
    ],
    license='Apache',
    packages=['saagie'],
    cmdclass={
        'install': InstallCommand,
    },
    install_requires=required,
    include_package_data=True,
)
