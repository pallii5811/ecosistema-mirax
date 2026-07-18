from evaluation.run_semantic_gold import _target_role_precision


def test_target_role_precision_excludes_correctly_rejected_role_inversions() -> None:
    rows = [
        {"predicted": True, "role_correct": True},
        {"predicted": False, "role_correct": False},
    ]

    assert _target_role_precision(rows) == 1.0


def test_target_role_precision_fails_for_promoted_wrong_role() -> None:
    rows = [
        {"predicted": True, "role_correct": True},
        {"predicted": True, "role_correct": False},
        {"predicted": False, "role_correct": False},
    ]

    assert _target_role_precision(rows) == 0.5


def test_target_role_precision_is_fail_closed_without_promoted_leads() -> None:
    assert _target_role_precision([{"predicted": False, "role_correct": True}]) == 0.0
