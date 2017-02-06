import json
import re

from jinja2 import Environment, PackageLoader, TemplateNotFound
from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler
import requests


VERSION = (0, 3, 0)
__version__ = '.'.join(map(str, VERSION))


env = Environment(
    loader=PackageLoader('saagie', 'jinja2'),
)
session = requests.Session()


class SaagieHandler(IPythonHandler):
    def get(self):
        data = self.request.arguments.copy()
        try:
            template = data.pop('template')[0].decode()
        except (KeyError, IndexError):
            template = ''
        try:
            template = env.get_template(template)
        except TemplateNotFound:
            self.send_error(404)
        self.finish(template.render({k: v[0].decode()
                                     for k, v in data.items()}))


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
        if url.startswith('/'):
            url = 'https://manager.prod.saagie.io' + url
        elif CONTAINER_RE.match(url) is None:
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
        response = session.request(method, url, data=data, json=json_data,
                                   timeout=5)
        if response.status_code != 200:
            self.send_error(response.status_code)
            return
        self.finish(response.text)

    def check_xsrf_cookie(self):
        return


def load_jupyter_server_extension(nb_app):
    web_app = nb_app.web_app
    base_url = web_app.settings['base_url']

    route_pattern = url_path_join(base_url, '/saagie/check')
    web_app.add_handlers('.*$', [(route_pattern, SaagieCheckHandler)])

    route_pattern = url_path_join(base_url, '/saagie')
    web_app.add_handlers('.*$', [(route_pattern, SaagieHandler)])

    route_pattern = url_path_join(base_url, '/saagie-proxy')
    web_app.add_handlers('.*$', [(route_pattern, SaagieProxyHandler)])
