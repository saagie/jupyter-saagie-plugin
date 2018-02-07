# Jupyter Saagie plugin
This plugin allows you to easily create a Saagie Python job from
a local Jupyter notebook.

## Install
In your Jupyter Python environment, run:
`pip install jupyter-saagie-plugin`

## Usage
Simply run `jupyter notebook` as always, you will see a new button
in the toolbar. Use it to log in to your account and deploy a job
using the code in your notebook. You can update an existing job as well.

For deploying to a Python job, Python 3.5 & 2.7 are supported.

If you want to pre-fill your Saagie root URL (used in the plugin's login form),
you can setup a `SAAGIE_ROOT_URL` environment variable before you run the notebook.

## Uninstall
```
pip uninstall jupyter-saagie-plugin
jupyter nbextension uninstall saagie --user
```

## Modifying this extension
In dev mode, you can use a Docker of Jupyter notebook and install this extension in it.
First, run a Jupyter Docker in bash mode:

```
docker run -it --rm -p 8888:8888 -v [your_project_path]/jupyter-saagie-plugin/:/jupyter-saagie-plugin/ [--env SAAGIE_ROOT_URL="https://xxx-manager.prod.saagie.io/"] saagie/jupyter-python-nbk:latest /bin/bash
```
_(Seting up the `SAAGIE_ROOT_URL` environment variable is optional)_

Then install the Jupyter extension in your Docker container:
```
cd /jupyter-saagie-plugin/
python3 setup.py install
cd /notebooks-dir
/usr/local/bin/start-notebook.sh --NotebookApp.token='' --NotebookApp.password=''
```

## Build and share
In order to build this plugin, run the following command:
```
python setup.py sdist
```
This will generate a tar.gz archive in the `dist` directory.

If you want to share it on Pypi, just install [twine](https://pypi.python.org/pypi/twine) (with `pip install twine`) and run:
```
twine upload dist/jupyter-saagie-plugin-x.x.x.tar.gz
```

But first, You can test your Pypi deployment on [TestPypi](https://testpypi.python.org/pypi) test environment. If so, just run:
```
twine upload --repository-url https://test.pypi.org/legacy/ dist/jupyter-saagie-plugin-x.x.x.tar.gz
``` 
