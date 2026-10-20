import { useState } from 'react';

export default function counter() {
  const [count, setCount] = useState(0);
  return { count, increment: () => setCount(value => value + 1) };
}
