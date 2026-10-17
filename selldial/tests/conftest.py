import pytest
from fastapi.testclient import TestClient

from agent import server


@pytest.fixture
def client():
    server.reset_state()
    return TestClient(server.app)
