Jupyter Saagie plugin
=====================

This plugin allows you to easily create a Saagie Python job from
a local Jupyter notebook.

Install
-------

In your Jupyter Python environment, run:

| ``pip install jupyter-saagie-plugin``

Usage
-----

Simply run ``jupyter notebook`` as always, you will see a new button
in the toolbar. Use it to log in to your account and deploy a job
using the code in your notebook. You can update an existing job as well.

For deploying to a Python job, Python 3.5 & 2.7 are supported.


Uninstall
---------

| ``pip uninstall jupyter-saagie-plugin``
| ``jupyter nbextension uninstall saagie --user``
