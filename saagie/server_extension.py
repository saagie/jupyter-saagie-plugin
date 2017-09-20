from functools import wraps
import json
import os
from time import sleep
import traceback

from jinja2 import Environment, PackageLoader
from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler
import requests


env = Environment(
    loader=PackageLoader('saagie', 'jinja2'),
)
session = requests.Session()


SAAGIE_ROOT_URL = 'https://manager.prod.saagie.io'
PLATFORMS_URL = SAAGIE_ROOT_URL + '/api-internal/v1/platform'
LOGIN_URL = SAAGIE_ROOT_URL + '/login_check'
JOB_URL_PATTERN = PLATFORMS_URL + '/%s/job'
JOB_UPGRADE_URL_PATTERN = JOB_URL_PATTERN + '/%s/version'
SCRIPT_UPLOAD_URL_PATTERN = JOB_URL_PATTERN + '/upload'

JUPYTER_KERNELS_TO_SAAGIE_NAMES = {
    'python2': 'jupyter',
    'python3': 'jupyter',
    'ir': 'r',
    'spark': 'scala-spark1.6',
    'ruby': 'ruby',
    'haskell': 'haskell',
    'julia-0.3': 'julia'
}


def get_absolute_saagie_url(saagie_url):
    if saagie_url.startswith('/'):
        return SAAGIE_ROOT_URL + saagie_url
    return saagie_url


class ResponseError(Exception):
    def __init__(self, status_code):
        self.status_code = status_code
        super(ResponseError, self).__init__(status_code)


class SaagieHandler(IPythonHandler):
    def handle_request(self, method):
        data = {k: v[0].decode() for k, v in self.request.arguments.items()}
        if 'view' not in data:
            self.send_error(404)
            return
        view_name = data.pop('view')
        notebook_path = data.pop('notebook_path', None)
        notebook_json = data.pop('notebook_json', None)
        notebook = Notebook(notebook_path, notebook_json)
        try:
            template_name, template_data = views.render(
                view_name, notebook=notebook, data=data, method=method)
        except ResponseError as e:
            self.send_error(e.status_code)
            return
        except:
            template_name = 'internal_error.html'
            template_data = {'error': traceback.format_exc()}
            self.set_status(500)
        template_data.update(
            notebook=notebook,
        )
        template = env.get_template(template_name)
        self.finish(template.render(template_data))

    def get(self):
        self.handle_request('GET')

    def post(self):
        self.handle_request('POST')

    def check_xsrf_cookie(self):
        return


class SaagieCheckHandler(IPythonHandler):
    def get(self):
        self.finish()


class SaagieJobRun:
    def __init__(self, job, run_data):
        self.job = job
        self.id = run_data['id']
        self.status = run_data['status']
        self.stderr = run_data.get('logs_err', '')
        self.stdout = run_data.get('logs_out', '')


class SaagieJob:
    def __init__(self, notebook, job_data):
        self.notebook = notebook
        self.notebook.current_job = self
        self.platform_id = job_data['platform_id']
        self.capsule_type = job_data['capsule_code']
        self.id = job_data['id']
        self.name = job_data['name']
        if self.is_jupyter:
            self.jupyter_domain = 'https://' + job_data['current']['url']
            self.jupyter_url = '%s/notebooks/%s' % (
                self.jupyter_domain, self.notebook.path)
        self.last_run = None

    @property
    def url(self):
        return (JOB_URL_PATTERN + '/%s') % (self.platform_id, self.id)

    @property
    def admin_url(self):
        return get_absolute_saagie_url('/#/manager/%s/job/%s'
                                       % (self.platform_id, self.id))

    @property
    def logs_url(self):
        return self.admin_url + '/logs'

    @property
    def is_jupyter(self):
        # Yes, this is a typo from Saagie internals.
        return self.capsule_type == 'jupiter'

    @property
    def is_started(self):
        return self.last_run is not None

    def fetch_logs(self):
        job_data = session.get(self.url).json()
        run_data = job_data.get('last_instance')
        if run_data is None or run_data['status'] not in ('SUCCESS', 'FAILED'):
            return
        run_data = session.get(
            get_absolute_saagie_url('/api-internal/v1/jobtask/%s'
                                    % run_data['id'])).json()
        self.last_run = SaagieJobRun(self, run_data)

    def wait_until_ready_to_upload_notebook(self):
        while True:
            response = session.get(self.jupyter_url)
            if response.status_code < 400:
                break
            sleep(3)

    def upload_notebook(self):
        upload_url = self.jupyter_url + '/api/contents/' + \
                     self.notebook.path
        session.put(upload_url, json={'content': self.notebook.json})

    @property
    def details_template_name(self):
        if self.is_jupyter:
            return 'include/jupyter_job_details.html'
        return 'include/python_job_details.html'


class Notebook:
    KERNELS_TO_SAAGIE_NAMES = {
        'python2': 'jupyter',
        'python3': 'jupyter',
        'ir': 'r',
        'spark': 'scala-spark1.6',
        'ruby': 'ruby',
        'haskell': 'haskell',
        'julia-0.3': 'julia'
    }
    CACHE = {}

    def __init__(self, path, json_data):
        if path is None:
            path = 'Untitled.ipynb'
        if json_data is None:
            json_data = json.dumps({
                'cells': [],
                'metadata': {'kernelspec': {'name': 'python3'}}})
        self.path = path
        self.json = json.loads(json_data)
        # In cached instances, current_job is already defined.
        if not hasattr(self, 'current_job'):
            self.current_job = None

    def __new__(cls, path, json):
        if path in cls.CACHE:
            return cls.CACHE[path]
        cls.CACHE[path] = new = super(Notebook, cls).__new__(cls)
        return new

    @property
    def name(self):
        return os.path.splitext(os.path.basename(self.path))[0]

    @property
    def kernel_name(self):
        return self.json['metadata']['kernelspec']['name']

    @property
    def kernel_display_name(self):
        return self.json['metadata']['kernelspec']['display_name']

    # For an unknown reason, Saagie uses different Jupyter notebook
    # kernel names than Jupyter itself.
    @property
    def saagie_kernel_name(self):
        return self.KERNELS_TO_SAAGIE_NAMES[self.kernel_name]

    def get_code_cells(self):
        return [cell['source'] for cell in self.json['cells']
                if cell['cell_type'] == 'code']

    def get_code(self, indices=None):
        cells = self.get_code_cells()
        if indices is None:
            indices = list(range(len(cells)))
        return '\n\n\n'.join([cells[i] for i in indices])


class ViewsCollection(dict):
    def add(self, func):
        self[func.__name__] = func
        return func

    def render(self, view_name, notebook, data=None, method='GET', **kwargs):
        if data is None:
            data = {}
        try:
            view = views[view_name]
        except KeyError:
            raise ResponseError(404)
        template_data = view(method, notebook, data, **kwargs)
        if isinstance(template_data, tuple):
            template_name, template_data = template_data
        else:
            template_name = view.__name__ + '.html'
        return template_name, template_data


views = ViewsCollection()


@views.add
def modal(method, notebook, data):
    return {}


def is_logged():
    response = session.get(PLATFORMS_URL, allow_redirects=False)
    return response.status_code == 200


@views.add
def login_form(method, notebook, data):
    if method == 'POST':
        session.post(LOGIN_URL,
                     {'_username': data['username'],
                      '_password': data['password']})
        if is_logged():
            return views.render('capsule_type_chooser', notebook)
        return {'error': 'Invalid username or password.'}
    if is_logged():
        return views.render('capsule_type_chooser', notebook)
    return {'error': None}


def login_required(view):
    @wraps(view)
    def inner(method, notebook, data, *args, **kwargs):
        if not is_logged():
            return views.render('login_form', notebook)
        return view(method, notebook, data, *args, **kwargs)
    return inner


@views.add
@login_required
def capsule_type_chooser(method, notebook, data):
    return {}


def get_job_form(method, notebook, data):
    platforms = session.get(PLATFORMS_URL).json()
    return {'platforms': platforms}


def create_job_base_data(data):
    return {
        'platform_id': data['saagie-platform'],
        'category': 'processing',
        'name': data['job-name'],
        'description': data['description'],
        'current': {
            'cpu': data['cpu'],
            'disk': data['disk'],
            'memory': data['ram'],
            'options': {}
        }
    }


def upload_python_script(notebook, data):
    code = notebook.get_code(map(int, data['code-lines'].split('|')))
    files = {'file': (data['job-name'] + '.py', code)}
    return session.post(
        SCRIPT_UPLOAD_URL_PATTERN % data['saagie-platform'],
        files=files).json()['fileName']


@views.add
@login_required
def python_job_form(method, notebook, data):
    if method == 'POST':
        platform_id = data['saagie-platform']
        job_data = create_job_base_data(data)
        job_data['capsule_code'] = 'python'
        current = job_data['current']
        current['options']['language_version'] = data['language-version']
        current['releaseNote'] = data['release-note']
        current['template'] = data['shell-command']
        current['file'] = upload_python_script(notebook, data)
        new_job_data = session.post(JOB_URL_PATTERN % platform_id,
                                    json=job_data).json()
        job = SaagieJob(notebook, new_job_data)
        return views.render('starting_job', notebook, {'job': job})

    context = get_job_form(method, notebook, data)
    context['action'] = '/saagie?view=python_job_form'
    return context


@views.add
@login_required
def update_python_job(method, notebook, data):
    if method == 'POST':
        job = notebook.current_job
        platform_id = job.platform_id
        data['saagie-platform'] = platform_id
        data['job-name'] = job.name
        data['description'] = ''
        current = create_job_base_data(data)['current']
        current['options']['language_version'] = data['language-version']
        current['releaseNote'] = data['release-note']
        current['template'] = data['shell-command']
        current['file'] = upload_python_script(notebook, data)
        session.post(JOB_UPGRADE_URL_PATTERN % (platform_id, job.id),
                     json={'current': current})
        job.last_run = None
        return views.render('starting_job', notebook, {'job': job})

    context = get_job_form(method, notebook, data)
    context['action'] = '/saagie?view=update_python_job'
    return context


@views.add
@login_required
def unsupported_kernel(method, notebook, data):
    return {}


@views.add
@login_required
def jupyter_job_form(method, notebook, data):
    if method == 'POST':
        platform_id = data['saagie-platform']
        job_data = create_job_base_data(data)
        job_data['capsule_code'] = 'jupiter'  # This typo is from Saagie’s API.
        try:
            saagie_kernel_name = notebook.saagie_kernel_name
        except KeyError:
            return views.render('unsupported_kernel', notebook)
        job_data['current']['options']['notebook'] = saagie_kernel_name
        new_job_data = session.post(JOB_URL_PATTERN % platform_id,
                                    json=job_data).json()
        job = SaagieJob(notebook, new_job_data)
        return views.render('starting_job', notebook, {'job': job})

    context = get_job_form(method, notebook, data)
    context['action'] = '/saagie?view=jupyter_job_form'
    return context


@views.add
@login_required
def starting_job(method, notebook, data):
    job = notebook.current_job
    job.fetch_logs()
    if job.is_started:
        if job.is_jupyter:
            job.wait_until_ready_to_upload_notebook()
            job.upload_notebook()
        return views.render('started_job', notebook, {'job': job})
    return {'job': job}


@views.add
@login_required
def started_job(method, notebook, data):
    return {'job': notebook.current_job}


def load_jupyter_server_extension(nb_app):
    web_app = nb_app.web_app
    base_url = web_app.settings['base_url']

    route_pattern = url_path_join(base_url, '/saagie')
    web_app.add_handlers('.*$', [(route_pattern, SaagieHandler)])

    route_pattern = url_path_join(base_url, '/saagie/check')
    web_app.add_handlers('.*$', [(route_pattern, SaagieCheckHandler)])
