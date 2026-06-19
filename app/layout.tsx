export const dynamic = "force-dynamic";

export const metadata = {
  title: 'BI Manager - Amazon Sellers',
  description: 'Panel de control inteligente para logística y finanzas',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}