from moeazi_agent.mobile_withdrawal_workflow import _address_topic


def test_address_topic_is_left_padded_and_normalized():
    address = "0x1234567890ABCDEF1234567890ABCDEF12345678"
    topic = _address_topic(address)
    assert topic == "0x" + address[2:].lower().rjust(64, "0")
    assert len(topic) == 66
