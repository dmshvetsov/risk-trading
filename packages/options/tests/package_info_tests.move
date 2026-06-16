#[test_only]
module options_trading_protocol::package_info_tests;

use options_trading_protocol::package_info;
use std::unit_test::assert_eq;

#[test]
fun package_version_starts_at_zero() {
    assert_eq!(package_info::version(), 0);
}
