import type { ConsentType } from './consent.types';

/**
 * Textos iniciales (versión 1) que se siembran si no existe ninguna política.
 * La dirección puede editarlos desde "Consentimientos"; cada edición crea una versión nueva.
 * `{centro}` se reemplaza por el nombre configurado en Marca.
 */
export const DEFAULT_POLICIES: Array<{
  type: ConsentType;
  title: string;
  required: boolean;
  body: string;
}> = [
  {
    type: 'data_processing',
    title: 'Tratamiento de los datos personales de su hijo o hija',
    required: true,
    body: `En {centro} registramos información de su hijo o hija para cuidarlo durante el día y mantenerle informado. Conforme a la Ley Orgánica de Protección de Datos Personales del Ecuador (LOPDP), necesitamos que usted, como representante legal, conozca y acepte este tratamiento.

Qué datos registramos
- Identificación: nombres, fecha de nacimiento, foto de ficha (carnet) y datos de sus representantes y personas autorizadas a retirarlo.
- Salud: alergias, condiciones médicas, medicación, tipo de sangre, pediatra y seguro.
- Día a día: asistencia (llegadas y retiros), comidas, siestas, cambios de pañal, actividades e incidentes.

Para qué los usamos
- Cuidar a su hijo o hija de forma segura (alergias, medicación, retiro sólo por personas autorizadas).
- Informarle cada día de cómo estuvo, mediante el portal familiar y el reporte diario.
- Cumplir nuestras obligaciones como centro de cuidado infantil.
No vendemos ni cedemos estos datos a terceros con fines comerciales.

Quién los ve
- El personal del centro, cada uno según su función (una educadora sólo ve los niños de su sala).
- Usted y los demás representantes registrados de su hijo o hija, en el portal familiar.
- Autoridades, sólo cuando la ley lo exija.

Cuánto tiempo los guardamos
Mientras su hijo o hija asista al centro y, después, sólo el tiempo que exijan las obligaciones legales. Luego se eliminan o se anonimizan.

Sus derechos
Puede solicitar en cualquier momento acceder a los datos, corregirlos, eliminarlos, oponerse a un tratamiento o revocar su consentimiento. Puede cambiar sus autorizaciones desde "Privacidad" en el portal familiar o pedirlo en la dirección del centro.

Contacto
Dirección de {centro}, en persona o por los canales oficiales del centro.`,
  },
  {
    type: 'images',
    title: 'Uso de fotografías de su hijo o hija',
    required: false,
    body: `Durante las actividades del día el personal de {centro} puede tomar fotografías de su hijo o hija. Esta autorización es voluntaria: si responde que no, no se tomarán fotos individuales de su hijo o hija y la atención que recibe no cambia.

Para qué se usan las fotos
- Mostrarle cómo fue su día en el portal familiar y en el reporte diario.
- Dejar constancia interna de actividades, comidas y del registro de llegada.

Quién las ve
- Usted y los demás representantes de su hijo o hija.
- El personal del centro.
- Las fotos grupales de una actividad pueden ser vistas por las familias de la misma sala.

Lo que nunca haremos
No publicaremos fotos de su hijo o hija en redes sociales, sitios web, publicidad ni ningún medio público sin una autorización escrita aparte y específica.

Puede retirar esta autorización en cualquier momento desde "Privacidad" en el portal familiar. Desde ese momento no se tomarán fotos nuevas de su hijo o hija.`,
  },
  {
    type: 'whatsapp',
    title: 'Avisos por WhatsApp',
    required: false,
    body: `{centro} puede enviarle por WhatsApp, al número que registró, avisos sobre su hijo o hija: llegada y retiro, novedades de salud, respuestas a justificaciones de ausencia y el reporte diario.

WhatsApp es un servicio de un tercero (Meta). Los mensajes contienen el nombre de su hijo o hija y un resumen de la novedad. Si responde que no, seguirá viendo toda la información en el portal familiar y el centro le contactará por otros medios ante una urgencia.

Puede cambiar esta decisión en cualquier momento desde "Privacidad" en el portal familiar.`,
  },
];
