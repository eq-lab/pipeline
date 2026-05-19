use pipeline_worker::price_poller::align_to_grid;

#[test]
fn test_align_to_grid() {
    // origin=100, interval=300
    assert_eq!(align_to_grid(100, 100, 300), 100);
    assert_eq!(align_to_grid(101, 100, 300), 400);
    assert_eq!(align_to_grid(399, 100, 300), 400);
    assert_eq!(align_to_grid(400, 100, 300), 400);
    assert_eq!(align_to_grid(401, 100, 300), 700);
    assert_eq!(align_to_grid(50, 100, 300), 100);
}
