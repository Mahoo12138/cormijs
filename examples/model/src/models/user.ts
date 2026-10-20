import { useState } from 'react';

export default function user() {
  const [name, setName] = useState('Ada');
  return { name, rename: (value: string) => setName(value) };
}
