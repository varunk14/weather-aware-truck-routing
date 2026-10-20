import pytest
from django.core.exceptions import ImproperlyConfigured

from config.env import env_bool, env_list, env_str


class TestEnvStr:
    def test_returns_stripped_value(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SAMPLE", "  value  ")
        assert env_str("SAMPLE") == "value"

    def test_falls_back_to_default_when_unset_or_blank(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("SAMPLE", raising=False)
        assert env_str("SAMPLE", "fallback") == "fallback"
        monkeypatch.setenv("SAMPLE", "   ")
        assert env_str("SAMPLE", "fallback") == "fallback"

    def test_raises_when_required_and_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("SAMPLE", raising=False)
        with pytest.raises(ImproperlyConfigured, match="SAMPLE"):
            env_str("SAMPLE")


class TestEnvBool:
    @pytest.mark.parametrize("raw", ["1", "true", "TRUE", "yes", "on"])
    def test_truthy_values(self, monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
        monkeypatch.setenv("FLAG", raw)
        assert env_bool("FLAG", default=False) is True

    @pytest.mark.parametrize("raw", ["0", "false", "No", "off"])
    def test_falsy_values(self, monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
        monkeypatch.setenv("FLAG", raw)
        assert env_bool("FLAG", default=True) is False

    def test_default_when_unset(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("FLAG", raising=False)
        assert env_bool("FLAG", default=True) is True

    def test_rejects_unrecognised_value(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("FLAG", "maybe")
        with pytest.raises(ImproperlyConfigured, match="FLAG"):
            env_bool("FLAG", default=False)


class TestEnvList:
    def test_splits_and_strips_items(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HOSTS", " a.example.com, ,b.example.com ")
        assert env_list("HOSTS") == ["a.example.com", "b.example.com"]

    def test_falls_back_to_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("HOSTS", raising=False)
        assert env_list("HOSTS", ["localhost"]) == ["localhost"]

    def test_raises_when_required_and_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HOSTS", " , ")
        with pytest.raises(ImproperlyConfigured, match="HOSTS"):
            env_list("HOSTS")
