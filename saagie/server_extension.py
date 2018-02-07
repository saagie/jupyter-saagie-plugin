from functools import wraps
import json
import os
import traceback
import validators

from jinja2 import Environment, PackageLoader
from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler
import requests


env = Environment(
    loader=PackageLoader('saagie', 'jinja2'),
)
session = requests.Session()

SAAGIE_ROOT_URL = os.environ.get("SAAGIE_ROOT_URL", None)
SAAGIE_USERNAME = None
PLATFORMS_URL = None
LOGIN_URL = None
JOBS_URL_PATTERN = None
JOB_URL_PATTERN = None
JOB_UPGRADE_URL_PATTERN = None
SCRIPT_UPLOAD_URL_PATTERN = None


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
    @classmethod
    def from_id(cls, notebook, platform_id, job_id):
        return SaagieJob(
            notebook,
            session.get(JOB_URL_PATTERN % (platform_id, job_id)).json())

    def __init__(self, notebook, job_data):
        self.notebook = notebook
        self.data = job_data
        self.platform_id = job_data['platform_id']
        self.capsule_type = job_data['capsule_code']
        self.id = job_data['id']
        self.name = job_data['name']
        self.last_run = None

    def set_as_current(self):
        self.notebook.current_job = self

    @property
    def url(self):
        return (JOBS_URL_PATTERN + '/%s') % (self.platform_id, self.id)

    @property
    def admin_url(self):
        return get_absolute_saagie_url('/#/manager/%s/job/%s'
                                       % (self.platform_id, self.id))

    @property
    def logs_url(self):
        return self.admin_url + '/logs'

    @property
    def is_started(self):
        return self.last_run is not None

    def fetch_logs(self):
        job_data = session.get(self.url).json()
        run_data = job_data.get('last_instance')
        if run_data is None or run_data['status'] not in ('SUCCESS', 'FAILED'):
            return
        run_data = session.get(
            get_absolute_saagie_url('/api/v1/jobtask/%s'
                                    % run_data['id'])).json()
        self.last_run = SaagieJobRun(self, run_data)

    @property
    def details_template_name(self):
        return 'include/python_job_details.html'

    def __str__(self):
        return self.name

    def __eq__(self, other):
        if other is None:
            return False
        return self.platform_id == other.platform_id and self.id == other.id

    def __lt__(self, other):
        if other is None:
            return False
        return self.id < other.id


class SaagiePlatform:
    SUPPORTED_CAPSULE_TYPES = {'python'}

    def __init__(self, notebook, platform_data):
        self.notebook = notebook
        self.id = platform_data['id']
        self.name = platform_data['name']
        self.capsule_types = {c['code'] for c in platform_data['capsules']}

    @property
    def is_supported(self):
        return not self.capsule_types.isdisjoint(self.SUPPORTED_CAPSULE_TYPES)

    def get_jobs(self):
        if not self.is_supported:
            return []

        jobs_data = session.get(JOBS_URL_PATTERN % self.id).json()
        return [SaagieJob(self.notebook, job_data) for job_data in jobs_data
                if job_data['category'] == 'processing' and
                job_data['capsule_code'] in self.SUPPORTED_CAPSULE_TYPES]

    def __eq__(self, other):
        return self.id == other.id


class Notebook:
    CACHE = {}

    def __new__(cls, path, json):
        if path in cls.CACHE:
            return cls.CACHE[path]
        cls.CACHE[path] = new = super(Notebook, cls).__new__(cls)
        return new

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

    @property
    def name(self):
        return os.path.splitext(os.path.basename(self.path))[0]

    @property
    def kernel_name(self):
        return self.json['metadata']['kernelspec']['name']

    @property
    def kernel_display_name(self):
        return self.json['metadata']['kernelspec']['display_name']

    def get_code_cells(self):
        return [cell['source'] for cell in self.json['cells']
                if cell['cell_type'] == 'code']

    def get_code(self, indices=None):
        cells = self.get_code_cells()
        if indices is None:
            indices = list(range(len(cells)))
        return '\n\n\n'.join([cells[i] for i in indices])

    def get_platforms(self):
        return [SaagiePlatform(self, platform_data)
                for platform_data in session.get(PLATFORMS_URL).json()]


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
    if SAAGIE_ROOT_URL is None:
        return False
    else:
        response = session.get(SAAGIE_ROOT_URL + '/api/v1/user-current', allow_redirects=False)
        return response.status_code == 200

def define_globals(saagie_root_url, saagie_username):
    if saagie_root_url is not None:
        global SAAGIE_ROOT_URL
        global SAAGIE_USERNAME
        global PLATFORMS_URL
        global LOGIN_URL
        global JOBS_URL_PATTERN
        global JOB_URL_PATTERN
        global JOB_UPGRADE_URL_PATTERN
        global SCRIPT_UPLOAD_URL_PATTERN
        SAAGIE_USERNAME = saagie_username
        SAAGIE_ROOT_URL = saagie_root_url.strip("/")
        PLATFORMS_URL = SAAGIE_ROOT_URL + '/api/v1/platform'
        LOGIN_URL = SAAGIE_ROOT_URL + '/login_check'
        JOBS_URL_PATTERN = PLATFORMS_URL + '/%s/job'
        JOB_URL_PATTERN = JOBS_URL_PATTERN + '/%s'
        JOB_UPGRADE_URL_PATTERN = JOBS_URL_PATTERN + '/%s/version'
        SCRIPT_UPLOAD_URL_PATTERN = JOBS_URL_PATTERN + '/upload'

@views.add
def login_form(method, notebook, data):
    if method == 'POST':
        # check if the given Saagie URL is well formed
        if not validators.url(data['saagie_root_url']):
            return {'error': 'Invalid URL', 'saagie_root_url': data['saagie_root_url'] or '', 'username': data['username'] or ''}

        define_globals(data['saagie_root_url'], data['username'])

        if LOGIN_URL is not None:
            try:
                session.post(LOGIN_URL,
                         {'_username': data['username'],
                          '_password': data['password']})
            except (requests.ConnectionError, requests.RequestException, requests.HTTPError, requests.TooManyRedirects, requests.Timeout) as err:
                print ('Error while trying to connect to Saagie: ', err)
                return {'error': 'Connection error', 'saagie_root_url': SAAGIE_ROOT_URL, 'username': SAAGIE_USERNAME or ''}
        if is_logged():
            return views.render('capsule_type_chooser', notebook)
        return {'error': 'Invalid URL, username or password.', 'saagie_root_url': SAAGIE_ROOT_URL, 'username': SAAGIE_USERNAME or ''}
    if is_logged():
        return views.render('capsule_type_chooser', notebook)
    return {'error': None, 'saagie_root_url': SAAGIE_ROOT_URL or '', 'username': SAAGIE_USERNAME or ''}


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
    context = {'platforms': notebook.get_platforms()}
    context['values'] = ({'current': {'options': {}}} if notebook.current_job is None
                         else notebook.current_job.data)
    return context


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
            'isInternalSubDomain': False,
            'isInternalPort': False,
            'options': {}
        }
    }


def upload_python_script(notebook, data):
    code = notebook.get_code(map(int, data.get('code-lines', '').split('|')))
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
        job_data['always_email'] = False
        job_data['manual'] = True
        job_data['retry'] = ''

        current = job_data['current']
        current['options']['language_version'] = data['language-version']
        current['releaseNote'] = data['release-note']
        current['template'] = data['shell-command']
        current['file'] = upload_python_script(notebook, data)

        new_job_data = session.post(JOBS_URL_PATTERN % platform_id,
                                    json=job_data).json()
        job = SaagieJob(notebook, new_job_data)
        job.set_as_current()
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
def select_python_job(method, notebook, data):
    if method == 'POST':
        platform_id, job_id = data['job'].split('-')
        notebook.current_job = SaagieJob.from_id(notebook, platform_id, job_id)
        return views.render('update_python_job', notebook, data)
    jobs_by_platform = []
    for platform in notebook.get_platforms():
        jobs = platform.get_jobs()
        if jobs:
            jobs_by_platform.append((platform,
                                     list(sorted(jobs, reverse=True))))
    return {'jobs_by_platform': jobs_by_platform,
            'action': '/saagie?view=select_python_job'}


@views.add
@login_required
def unsupported_kernel(method, notebook, data):
    return {}


@views.add
@login_required
def starting_job(method, notebook, data):
    job = notebook.current_job
    job.fetch_logs()
    if job.is_started:
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
