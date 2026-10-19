from pathlib import Path

import pytest

from volsurf.fixtures import load

FIXTURE = Path(__file__).parent / "fixtures" / "deribit_snapshot.json.gz"


@pytest.fixture(scope="session")
def payload():
    return load(FIXTURE)
