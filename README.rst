Jupyter Saagie plugin
=====================

This plugin allows you to easily create a Saagie Python or Jupyter job from
a local Jupyter notebook.

Install
-------

In your Jupyter Python environment, run:

| ``pip install https://github.com/saagie/jupyter-saagie-plugin/archive/0.6.0.tar.gz``

Usage
-----

Simply run ``jupyter notebook`` as always, you will see a new button
in the toolbar. Use it to log on your account and deploy the notebook.

For deploying to a Python job, Python 3.6 & 2.7 are supported.

For deploying to a Jupyter job, these kernels are currently supported:

- Python 2
- Python 3
- R
- Scala & Spark
- Ruby
- Haskell
- Julia

Uninstall
---------

| ``pip uninstall jupyter-saagie-plugin``
| ``jupyter nbextension uninstall saagie --user``
