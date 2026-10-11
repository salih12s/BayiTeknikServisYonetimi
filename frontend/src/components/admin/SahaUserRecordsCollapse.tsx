import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  Collapse,
} from '@mui/material';
import { Engineering, PersonAdd } from '@mui/icons-material';
import { SahaKayit } from '../../types';

interface Props {
  open: boolean;
  displayName: string;
  records: SahaKayit[] | undefined;
}

const SahaUserRecordsCollapse: React.FC<Props> = ({ open, displayName, records }) => (
  <Collapse in={open} timeout="auto" unmountOnExit>
    <Box sx={{ bgcolor: '#e3f2fd', p: 2 }}>
      <Typography variant="h6" gutterBottom sx={{ color: '#1976d2', display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Engineering sx={{ fontSize: '1.3rem' }} />
        {displayName} - Saha Kayıtları ({records?.length || 0} adet)
      </Typography>
      {records && records.length > 0 ? (
        <TableContainer component={Paper} sx={{ maxHeight: 400, overflow: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, bgcolor: '#1976d2', color: 'white' }}>Fotoğraf</TableCell>
                <TableCell sx={{ fontWeight: 600, bgcolor: '#1976d2', color: 'white' }}>İsim</TableCell>
                <TableCell sx={{ fontWeight: 600, bgcolor: '#1976d2', color: 'white' }}>Soyisim</TableCell>
                <TableCell sx={{ fontWeight: 600, bgcolor: '#1976d2', color: 'white' }}>Notlar</TableCell>
                <TableCell sx={{ fontWeight: 600, bgcolor: '#1976d2', color: 'white' }}>Tarih</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id} hover sx={{ '&:hover': { bgcolor: '#bbdefb' } }}>
                  <TableCell>
                    {record.foto_preview ? (
                      <img
                        src={record.foto_preview}
                        loading="lazy"
                        alt={`${record.isim} ${record.soyisim}`}
                        style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4 }}
                      />
                    ) : (
                      <Box sx={{
                        width: 50,
                        height: 50,
                        bgcolor: '#f5f5f5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 1,
                      }}>
                        <PersonAdd sx={{ color: '#ccc' }} />
                      </Box>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 500 }}>{record.isim}</TableCell>
                  <TableCell sx={{ fontWeight: 500 }}>{record.soyisim}</TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>
                    <Typography variant="body2" noWrap title={record.notlar}>
                      {record.notlar || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                    {new Date(record.created_at).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Alert severity="info">Bu saha elemanının henüz kaydı yok.</Alert>
      )}
    </Box>
  </Collapse>
);

export default SahaUserRecordsCollapse;
