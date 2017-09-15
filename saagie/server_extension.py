import json
import re

from jinja2 import Environment, PackageLoader, TemplateNotFound
from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler
import requests


env = Environment(
    loader=PackageLoader('saagie', 'jinja2'),
)
session = requests.Session()


SAAGIE_ROOT_URL = 'https://manager.prod.saagie.io'


def get_absolute_saagie_url(saagie_url):
    if saagie_url.startswith('/'):
        return SAAGIE_ROOT_URL + saagie_url
    return saagie_url


class SaagieHandler(IPythonHandler):
    def get(self):
        data = {k: v[0].decode() for k, v in self.request.arguments.items()}
        template = data.pop('template') if 'template' in data else ''
        data.update(
            get_absolute_saagie_url=get_absolute_saagie_url,
            SAAGIE_ROOT_URL=SAAGIE_ROOT_URL,
        )
        try:
            template = env.get_template(template)
        except TemplateNotFound:
            self.send_error(404)
        self.finish(template.render(data))


class SaagieCheckHandler(IPythonHandler):
    def get(self):
        self.finish()


CONTAINER_RE = re.compile(r'^https?://[^/]+\.prod\.saagie\.io(?:\Z|/.*)$')


class SaagieProxyHandler(IPythonHandler):
    def post(self):
        data = self.request.arguments.copy()
        try:
            url = data.pop('url')[0].decode()
        except (KeyError, IndexError):
            url = ''
        url = get_absolute_saagie_url(url)
        if CONTAINER_RE.match(url) is None:
            self.send_error(404)
            return
        try:
            method = data.pop('method')[0].decode()
        except (KeyError, IndexError):
            method = 'GET'
        try:
            json_data = json.loads(data.pop('json')[0].decode())
        except (KeyError, IndexError, ValueError):
            json_data = None
        try:
            filename = data.pop('filename')[0].decode()
            files = {'file': (filename + '.py', data.pop('file')[0].decode())}
        except (KeyError, IndexError):
            files = {}
        allow_redirects = data.pop('allow_redirects', 'true') == 'true'
        response = session.request(
            method, url, data=data, json=json_data, files=files,
            timeout=5, allow_redirects=allow_redirects)
        if response.status_code != 200:
            self.send_error(response.status_code)
            return
        self.finish(response.text)

    def check_xsrf_cookie(self):
        return


def load_jupyter_server_extension(nb_app):
    web_app = nb_app.web_app
    base_url = web_app.settings['base_url']

    route_pattern = url_path_join(base_url, '/saagie')
    web_app.add_handlers('.*$', [(route_pattern, SaagieHandler)])

    route_pattern = url_path_join(base_url, '/saagie/check')
    web_app.add_handlers('.*$', [(route_pattern, SaagieCheckHandler)])

    route_pattern = url_path_join(base_url, '/saagie/proxy')
    web_app.add_handlers('.*$', [(route_pattern, SaagieProxyHandler)])
