const checkWinner = (board, lastMove) => {
  if (!lastMove) return null;

  const { row, col, player } = lastMove;
  
  // Directions: [dx, dy]
  // [0, 1] Horizontal
  // [1, 0] Vertical
  // [1, 1] Diagonal \
  // [1, -1] Diagonal /
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  for (let [dx, dy] of directions) {
    let count = 1;

    // Check forward
    let r = row + dx;
    let c = col + dy;
    while (board.some(s => s.row === r && s.col === c && s.player === player)) {
      count++;
      r += dx;
      c += dy;
    }

    // Check backward
    r = row - dx;
    c = col - dy;
    while (board.some(s => s.row === r && s.col === c && s.player === player)) {
      count++;
      r -= dx;
      c -= dy;
    }

    if (count >= 5) return player;
  }

  return null;
};

module.exports = { checkWinner };
